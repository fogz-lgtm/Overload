import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RestWatcher } from './components/RestWatcher';
import { StravaReturn } from './components/StravaReturn';
import { TabBar } from './components/TabBar';
import { db } from './db/db';
import { AskHost } from './ui/ask';
import { ToastHost } from './ui/toast';
import { useProfile } from './hooks';
import { ExerciseDetail } from './pages/ExerciseDetail';
import { History } from './pages/History';
import { Library } from './pages/Library';
import { Onboarding } from './pages/Onboarding';
import { Progress } from './pages/Progress';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import { WorkoutDetail } from './pages/WorkoutDetail';
import { WorkoutLogger } from './pages/WorkoutLogger';
import { autoSyncStrava, readStravaReturn } from './strava/client';

// The coach pulls in the Anthropic SDK; only load it for people who use it.
const Coach = lazy(() => import('./pages/Coach').then((m) => ({ default: m.Coach })));

export function App() {
  const profile = useProfile();
  // Strava sends the lifter back here with a sign-in code in the address bar.
  const [stravaReturn, setStravaReturn] = useState(readStravaReturn);
  if (stravaReturn) return <StravaReturn info={stravaReturn} onDone={() => setStravaReturn(null)} />;
  if (profile === undefined) return null;
  if (profile === null || !profile.onboarded) return <Onboarding />;

  // Hash routing keeps the app working from any static host (GitHub Pages, a USB stick…).
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const { pathname } = useLocation();
  // Logging a workout is a focused, full-screen task: no tab bar.
  const focus = pathname.startsWith('/workout/');
  // null once it's known there's no workout under way; undefined while loading.
  const current = useLiveQuery(async () => (await db.workouts.where('status').equals('active').first()) ?? null);
  const active = current ?? undefined;
  useStravaAutoSync();
  return (
    <>
      <main className={`app${focus ? ' focus' : active ? ' docked' : ''}`}>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/workout/:id" element={<WorkoutLogger />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<WorkoutDetail />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/:id" element={<ExerciseDetail />} />
          <Route
            path="/coach"
            element={
              <Suspense fallback={null}>
                <Coach />
              </Suspense>
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!focus && <TabBar active={active} />}
      <RestWatcher active={current} />
      <ToastHost />
      <AskHost />
    </>
  );
}

/** Pulls in new Strava activities when the app opens or comes back to the front. */
function useStravaAutoSync() {
  useEffect(() => {
    void autoSyncStrava();
    const onShow = () => {
      if (document.visibilityState === 'visible') void autoSyncStrava();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);
}
