import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_MODEL, MODELS, friendlyError, runTurn } from '../ai/coach';
import { MuscleThumb } from '../components/BodyMap';
import { Icon, type IconName } from '../components/Icon';
import { db, type ChatMessage, type ChatThread } from '../db/db';
import { formatWeight } from '../engine/load';
import type { Exercise, Units, Workout } from '../engine/types';
import { useExercises, useProfile } from '../hooks';
import './Coach.css';

const THREAD_ID = 'main';

const STARTERS: { icon: IconName; text: string }[] = [
  { icon: 'suitcase', text: "I've got 30 minutes at a hotel gym — build me something." },
  { icon: 'progress', text: 'Why might my bench press be stalling?' },
  { icon: 'run', text: 'I ran 10 km hard yesterday. What should I train today?' },
  { icon: 'target', text: 'How balanced is my training this week?' },
];

const CAPABILITIES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'dumbbell', title: 'Builds workouts from plain English', body: '“30 minutes, hotel gym, sore shoulder” becomes a session you can start.' },
  { icon: 'progress', title: 'Diagnoses stalls from your history', body: 'Finds why a lift has flattened and what to change next.' },
  { icon: 'run', title: 'Adjusts around runs and soreness', body: 'Mention yesterday’s long run and today’s plan accounts for it.' },
];

type ExerciseMap = Record<string, Exercise>;

export function Coach() {
  const profile = useProfile();
  const thread = useLiveQuery(async () => (await db.chats.get(THREAD_ID)) ?? null);
  const ex = useExercises();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ user: string; text: string } | null>(null);
  const [error, setError] = useState<{ text: string; message: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    if (count || pending || error) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [count, pending, error]);
  useEffect(() => () => abort.current?.abort(), []);

  if (profile === undefined || thread === undefined) return null;
  const apiKey = profile?.ai?.apiKey?.trim();
  const model = profile?.ai?.model || DEFAULT_MODEL;
  const messages = thread?.messages ?? [];
  const units = profile?.units ?? 'kg';

  async function send(text: string) {
    const userText = text.trim();
    if (!userText || pending || !apiKey) return;
    setInput('');
    setError(null);
    setPending({ user: userText, text: '' });
    const controller = new AbortController();
    abort.current = controller;
    try {
      // Switching models starts a fresh transcript: another model can't reuse this one's reasoning.
      const history = thread && thread.model === model ? thread.api : [];
      const result = await runTurn({
        apiKey,
        model,
        history,
        userText,
        signal: controller.signal,
        onText: (t) => setPending({ user: userText, text: t }),
      });
      const now = Date.now();
      const shown: ChatMessage[] = [
        { role: 'user', text: userText, at: now },
        { role: 'assistant', text: result.text || 'Done.', workoutId: result.workoutId, at: now },
      ];
      const next: ChatThread = {
        id: THREAD_ID,
        updatedAt: now,
        model,
        messages: [...messages, ...shown],
        api: [...history, ...result.appended],
      };
      await db.chats.put(next);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError({ text: userText, message: friendlyError(err) });
        setInput(userText);
      }
    } finally {
      setPending(null);
      abort.current = null;
    }
  }

  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;

  return (
    <div className={`page coach${apiKey ? ' chatting' : ''}`}>
      <header className="coach-head">
        {apiKey && <CoachAvatar size={44} />}
        <div className="grow">
          <h1>Coach</h1>
          <div className="sub">{apiKey ? `${modelLabel} · sees your training data` : 'Optional · bring your own API key'}</div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="icon-btn"
            aria-label="New chat"
            title="New chat"
            disabled={!!pending}
            onClick={async () => {
              if (confirm('Start a new conversation?')) await db.chats.delete(THREAD_ID);
            }}
          >
            <Icon name="edit" size={19} />
          </button>
        )}
      </header>

      {!apiKey ? (
        <NoKey />
      ) : (
        <>
          {messages.length === 0 && !pending && (
            <section className="coach-hello">
              <h2>{profile?.name ? `Hi ${profile.name}, what’s the plan?` : 'Hi, what’s the plan?'}</h2>
              <p className="muted">I can see your recovery, weekly volume and every set you’ve logged.</p>
              <div className="coach-starters">
                {STARTERS.map((s) => (
                  <button key={s.text} type="button" className="coach-starter" onClick={() => send(s.text)}>
                    <Icon name={s.icon} size={18} />
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="coach-thread" aria-live="polite" aria-busy={!!pending}>
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="bubble user">
                  {m.text}
                </div>
              ) : (
                <AssistantTurn key={i}>
                  <div className="bubble assistant">{m.text}</div>
                  {m.workoutId && <WorkoutCard id={m.workoutId} units={units} byId={ex?.byId} />}
                </AssistantTurn>
              ),
            )}
            {pending && (
              <>
                <div className="bubble user">{pending.user}</div>
                <AssistantTurn>
                  {pending.text ? (
                    <div className="bubble assistant coach-streaming">{pending.text}</div>
                  ) : (
                    <div className="bubble assistant coach-typing" aria-label="Coach is thinking">
                      <span className="typing">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  )}
                </AssistantTurn>
              </>
            )}
            {error && !pending && (
              <div className="coach-error" role="alert">
                <Icon name="info" size={18} />
                <p className="grow">{error.message}</p>
                <button type="button" className="btn sm" onClick={() => send(error.text)}>
                  <Icon name="refresh" size={15} />
                  Retry
                </button>
              </div>
            )}
          </div>

          <form
            className="composer coach-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <div className="inner">
              <div className="coach-field">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={pending ? 'Coach is replying…' : 'Message your coach'}
                  aria-label="Message your coach"
                  disabled={!!pending}
                  enterKeyHint="send"
                />
                {pending ? (
                  <button type="button" className="coach-send stop" onClick={() => abort.current?.abort()} aria-label="Stop">
                    <Icon name="stop" size={16} />
                  </button>
                ) : (
                  <button type="submit" className="coach-send" disabled={!input.trim()} aria-label="Send">
                    <Icon name="arrowUp" size={20} />
                  </button>
                )}
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function CoachAvatar({ size = 28 }: { size?: number }) {
  return (
    <span className="coach-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="sparkle" size={Math.round(size * 0.5)} />
    </span>
  );
}

function AssistantTurn({ children }: { children: ReactNode }) {
  return (
    <div className="coach-turn">
      <CoachAvatar />
      <div className="coach-turn-body">{children}</div>
    </div>
  );
}

function NoKey() {
  return (
    <div className="coach-intro">
      <section className="coach-intro-hero">
        <CoachAvatar size={76} />
        <h2>A coach that has read every set you’ve logged</h2>
        <p className="muted">Ask in plain English. It checks your recovery, volume and history before it answers.</p>
      </section>

      <ul className="card coach-caps">
        {CAPABILITIES.map((c) => (
          <li key={c.title}>
            <span className="coach-cap-icon">
              <Icon name={c.icon} size={20} />
            </span>
            <div className="grow">
              <strong>{c.title}</strong>
              <p className="small muted">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="coach-privacy">
        <Icon name="lock" size={18} />
        <p className="small">
          Uses your own Anthropic API key. It’s stored only on this device and sent only to api.anthropic.com. Everything else in Overload works without it.
        </p>
      </div>

      <Link to="/settings" className="btn primary lg block">
        <Icon name="key" size={20} />
        Add your API key
      </Link>
    </div>
  );
}

const STATUS: Record<Workout['status'], { label: string; action: string; icon: IconName }> = {
  planned: { label: 'Ready to start', action: 'View & start', icon: 'play' },
  active: { label: 'In progress', action: 'Resume', icon: 'play' },
  done: { label: 'Completed', action: 'See results', icon: 'progress' },
};

function WorkoutCard({ id, units, byId }: { id: string; units: Units; byId?: ExerciseMap }) {
  const workout = useLiveQuery(async () => (await db.workouts.get(id)) ?? null, [id]);
  if (!workout) return null;
  const status = STATUS[workout.status];
  const to = workout.status === 'done' ? `/history/${workout.id}` : workout.status === 'active' ? `/workout/${workout.id}` : '/';
  const [title, ...focus] = workout.name.split(' · ');
  const shown = workout.exercises.slice(0, 4);
  const more = workout.exercises.length - shown.length;
  return (
    <article className={`card coach-workout ${workout.status}`}>
      <header className="coach-workout-head">
        <span className="eyebrow">
          <span className="coach-dot" />
          {status.label}
        </span>
        <h3>{title}</h3>
        <span className="small muted">
          {focus.length > 0 && `${focus.join(' · ')} · `}
          <span className="num">
            ~{workout.estimatedMinutes} min · {workout.exercises.length} exercises
          </span>
        </span>
      </header>
      <ul className="coach-ex">
        {shown.map((we) => {
          const e = byId?.[we.exerciseId];
          const working = we.sets.filter((s) => s.kind === 'working');
          const top = working[0];
          return (
            <li key={we.id}>
              {e ? <MuscleThumb primary={e.primary} secondary={e.secondary} size={40} /> : <span className="coach-ex-blank" />}
              <div className="grow">
                <div className="coach-ex-name truncate">{e?.name ?? we.exerciseId}</div>
                <div className="small faint num">
                  {working.length} × {top?.targetReps ?? we.repRange[0]}
                  {top && top.targetWeightKg > 0 ? ` @ ${formatWeight(top.targetWeightKg, units)}` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <p className="small faint coach-more">
          + {more} more exercise{more > 1 ? 's' : ''}
        </p>
      )}
      <Link to={to} className={`btn block${workout.status === 'planned' ? ' primary' : ''}`}>
        <Icon name={status.icon} size={16} />
        {status.action}
      </Link>
    </article>
  );
}
