import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useState } from 'react';
import { db } from '../db/db';
import { setPref } from '../db/repo';
import type { Exercise, ExercisePref } from '../engine/types';
import { EXERCISE_VIDEOS, videoEmbed, videoFor, videoSearch, videoThumb, youtubeId } from '../engine/videos';
import { haptics } from '../ui/haptics';
import { toast } from '../ui/toast';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './ExerciseVideo.css';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** The exercise's video, once its preference has loaded: the lifter's own pick or the built-in demo. */
export function useExerciseVideo(exerciseId: string): { id?: string; pref: ExercisePref | null } | undefined {
  const pref = useLiveQuery(async () => (await db.prefs.get(exerciseId)) ?? null, [exerciseId]);
  if (pref === undefined) return undefined;
  return { id: videoFor(exerciseId, pref), pref };
}

/**
 * Form demo. Shows a poster until tapped, then loads YouTube's
 * privacy-enhanced player, so nothing streams unless you ask for it.
 */
export function ExerciseVideo({ exercise, autoPlay = false }: { exercise: Exercise; autoPlay?: boolean }) {
  const video = useExerciseVideo(exercise.id);
  const online = useOnline();
  const [started, setStarted] = useState(false);
  const [noPoster, setNoPoster] = useState(false);
  const id = video?.id;
  // A different video always starts back at its poster.
  const [shown, setShown] = useState(id);
  if (id !== shown) {
    setShown(id);
    setStarted(false);
    setNoPoster(false);
  }
  if (!id) return null;
  const playing = autoPlay || started;

  return (
    <div className="xv">
      {playing && online ? (
        <iframe src={videoEmbed(id)} title={`${exercise.name} form demo`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      ) : (
        <button type="button" className="xv-poster" onClick={() => setStarted(true)} disabled={!online} aria-label={online ? `Play ${exercise.name} form demo` : `${exercise.name} form demo, available when you're online`}>
          {!noPoster && <img src={videoThumb(id)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setNoPoster(true)} />}
          <span className="xv-play" aria-hidden="true">
            <Icon name="play" size={22} />
          </span>
          <span className="xv-caption" aria-hidden="true">
            {online ? 'Form demo' : 'Connect to watch'}
          </span>
        </button>
      )}
    </div>
  );
}

/** Full-width player in a sheet, for mid-workout form checks. */
export function VideoSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={exercise.name} subtitle="Form demo">
      <div className="stack lg">
        <ExerciseVideo exercise={exercise} autoPlay />
        {exercise.cues.length > 0 && (
          <ol className="xv-cues">
            {exercise.cues.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        )}
      </div>
    </Sheet>
  );
}

/** Paste a YouTube link to use your own video for an exercise. */
export function VideoLinkSheet({ exercise, current, onClose }: { exercise: Exercise; current?: string; onClose: () => void }) {
  const inputId = useId();
  const [text, setText] = useState('');
  const id = youtubeId(text);
  const builtIn = !!EXERCISE_VIDEOS[exercise.id];
  const invalid = text.trim().length > 0 && !id;

  const save = async (video: string | undefined, message: string) => {
    await setPref(exercise.id, { video });
    haptics.tap();
    toast(message, { icon: 'check', tone: 'accent' });
  };

  return (
    <Sheet open onClose={onClose} title={current ? 'Change video' : builtIn ? 'Use your own video' : 'Add a video'} subtitle={`Paste a YouTube link for ${exercise.name}.`}>
      {(close) => (
        <form
          className="stack lg"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!id) return;
            void save(id, 'Video saved');
            close();
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor={inputId}>
              YouTube link
            </label>
            <input
              id={inputId}
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://youtu.be/…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={invalid}
              aria-describedby={`${inputId}-hint`}
            />
            <span id={`${inputId}-hint`} className={`small ${invalid ? 'xv-error' : 'faint'}`}>
              {invalid ? "That doesn't look like a YouTube link." : 'Works with watch, youtu.be and Shorts links.'}
            </span>
          </div>
          {id && (
            <div className="xv xv-preview" aria-hidden="true">
              <img src={videoThumb(id)} alt="" referrerPolicy="no-referrer" />
            </div>
          )}
          <a className="btn ghost block" href={videoSearch(exercise.name)} target="_blank" rel="noreferrer">
            <Icon name="search" size={17} /> Find one on YouTube
          </a>
          <div className="stack">
            <button type="submit" className="btn primary lg block" disabled={!id}>
              Save video
            </button>
            {current && (
              <button
                type="button"
                className="btn quiet block"
                onClick={() => {
                  void save(undefined, builtIn ? 'Back to the built-in video' : 'Video removed');
                  close();
                }}
              >
                {builtIn ? 'Use the built-in video' : 'Remove video'}
              </button>
            )}
          </div>
        </form>
      )}
    </Sheet>
  );
}
