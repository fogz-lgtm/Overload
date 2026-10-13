import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_MODEL, MODELS, friendlyError, runTurn } from '../ai/coach';
import { Icon } from '../components/Icon';
import { db, type ChatMessage, type ChatThread } from '../db/db';
import { useProfile } from '../hooks';

const THREAD_ID = 'main';

const STARTERS = [
  "I've got 30 minutes at a hotel gym — build me something.",
  'Why might my bench press be stalling?',
  'I ran 10 km hard yesterday. What should I train today?',
  'How balanced is my training this week?',
];

export function Coach() {
  const profile = useProfile();
  const thread = useLiveQuery(async () => (await db.chats.get(THREAD_ID)) ?? null);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ user: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages.length, pending?.text]);
  useEffect(() => () => abort.current?.abort(), []);

  if (profile === undefined || thread === undefined) return null;
  const apiKey = profile?.ai?.apiKey?.trim();
  const model = profile?.ai?.model || DEFAULT_MODEL;
  const messages = thread?.messages ?? [];

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
        setError(friendlyError(err));
        setInput(userText);
      }
    } finally {
      setPending(null);
      abort.current = null;
    }
  }

  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <header className="page-header">
        <div>
          <h1>Coach</h1>
          <div className="sub">{apiKey ? `${modelLabel} · sees your training data` : 'Optional · bring your own API key'}</div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              if (confirm('Start a new conversation?')) await db.chats.delete(THREAD_ID);
            }}
          >
            New chat
          </button>
        )}
      </header>

      {!apiKey ? (
        <section className="card stack">
          <h3>Talk to an AI coach about your training</h3>
          <p className="small muted">
            The coach reads your logs, recovery and volume, explains why the app prescribed what it did, diagnoses stalls, and can
            build a workout from a plain-English request ("30 minutes, hotel gym, my shoulder's sore").
          </p>
          <p className="small muted">
            Everything else in Overload works without it. It uses your own Anthropic API key, stored only on this device and sent
            only to api.anthropic.com.
          </p>
          <Link to="/settings" className="btn primary">
            Add an API key
          </Link>
        </section>
      ) : (
        <>
          {messages.length === 0 && !pending && (
            <div className="stack">
              <p className="muted small">Ask anything about your training. Try:</p>
              {STARTERS.map((s) => (
                <button key={s} type="button" className="option-card" onClick={() => send(s)}>
                  <span style={{ color: 'var(--text-1)' }}>{s}</span>
                </button>
              ))}
            </div>
          )}
          <div className="stack" aria-live="polite">
            {messages.map((m, i) => (
              <Bubble key={i} m={m} />
            ))}
            {pending && (
              <>
                <div className="bubble user">{pending.user}</div>
                <div className="bubble assistant">{pending.text || <span className="faint">Thinking…</span>}</div>
              </>
            )}
            {error && (
              <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <div className="inner">
              <input
                className="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message your coach"
                aria-label="Message your coach"
                disabled={!!pending}
                enterKeyHint="send"
              />
              {pending ? (
                <button type="button" className="icon-btn" onClick={() => abort.current?.abort()} aria-label="Stop">
                  <Icon name="x" />
                </button>
              ) : (
                <button type="submit" className="btn primary" disabled={!input.trim()} aria-label="Send">
                  <Icon name="send" size={18} />
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const workout = useLiveQuery(async () => (m.workoutId ? ((await db.workouts.get(m.workoutId)) ?? null) : null), [m.workoutId]);
  return (
    <>
      <div className={`bubble ${m.role}`}>{m.text}</div>
      {workout && (
        <Link
          to={workout.status === 'done' ? `/history/${workout.id}` : workout.status === 'active' ? `/workout/${workout.id}` : '/'}
          className="btn sm"
          style={{ alignSelf: 'flex-start' }}
        >
          <Icon name="dumbbell" size={16} /> {workout.status === 'planned' ? 'View workout' : workout.status === 'active' ? 'Resume workout' : 'See results'}
        </Link>
      )}
    </>
  );
}
