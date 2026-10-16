import { useEffect } from 'react';
import { keepScreenOn, letScreenSleep, releaseRestAudio, restOver, setRest, stopRestTrack, useRest } from '../audio/restAlert';
import type { Workout } from '../engine/types';
import { useProfile } from '../hooks';
import { haptics } from '../ui/haptics';
import { toast } from '../ui/toast';

/**
 * Runs the rest timer app-wide: it dings when the rest is up on whatever tab
 * the lifter is on, and keeps the screen on while a workout is under way.
 */
export function RestWatcher({ active }: { active: Workout | null | undefined }) {
  const rest = useRest();
  const profile = useProfile();
  const sound = profile?.style?.restSound ?? 'ding';
  const keepAwake = profile?.style?.keepAwake !== false;
  const activeId = active?.id;

  useEffect(() => {
    if (!rest || active === undefined) return;
    // The workout it belonged to was finished or thrown away.
    if (rest.workoutId !== activeId) {
      setRest(null);
      stopRestTrack();
      return;
    }
    const fire = () => {
      haptics.alarm();
      restOver(sound, rest.endsAt);
      toast('Rest over — next set', { icon: 'timer', tone: 'accent', ms: 1800 });
      setRest(null);
    };
    if (Date.now() >= rest.endsAt) return fire();
    const timer = setTimeout(fire, rest.endsAt - Date.now());
    // Timers sleep with a hidden app; catch up on return.
    const onShow = () => {
      if (document.visibilityState === 'visible' && Date.now() >= rest.endsAt) fire();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [rest, sound, active, activeId]);

  // No workout left (finished elsewhere, or discarded): let go of the lock screen.
  useEffect(() => {
    if (active === null) releaseRestAudio();
  }, [active]);

  // The browser drops the lock when the app is hidden; take it again on return.
  useEffect(() => {
    if (!activeId || !keepAwake) return;
    void keepScreenOn();
    const onShow = () => {
      if (document.visibilityState === 'visible') void keepScreenOn();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      letScreenSleep();
    };
  }, [activeId, keepAwake]);

  return null;
}
