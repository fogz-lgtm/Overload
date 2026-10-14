import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useProfile } from '../hooks';
import { clearStravaReturn, finishConnect, type StravaReturn as ReturnInfo } from '../strava/client';
import { haptics } from '../ui/haptics';
import { Icon, type IconName } from './Icon';
import './StravaReturn.css';

type Stage =
  | { kind: 'working' }
  | { kind: 'done'; athlete?: string; added: number }
  | { kind: 'error'; message: string }
  | { kind: 'denied' }
  /** Signed in from a different browser than the one with Overload's data in it. */
  | { kind: 'elsewhere' };

// A code works once; StrictMode's double effect mustn't spend it twice.
const spent = new Set<string>();

/** Where Strava sends the lifter back after approving (or refusing) access. */
export function StravaReturn({ info, onDone }: { info: ReturnInfo; onDone: () => void }) {
  const profile = useProfile();
  const [stage, setStage] = useState<Stage>({ kind: 'working' });
  const [copied, setCopied] = useState(false);
  const hasApp = !!profile?.strava?.clientId && !!profile.strava.clientSecret;
  const started = useRef(false);

  const finish = (code: string) => {
    if (spent.has(code)) return;
    spent.add(code);
    setStage({ kind: 'working' });
    finishConnect(code)
      .then(({ athlete, added }) => {
        haptics.success();
        setStage({ kind: 'done', athlete, added });
      })
      .catch((err: unknown) => setStage({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
  };

  useEffect(() => {
    if (profile === undefined || started.current) return;
    started.current = true;
    if (info.error || !info.code) setStage({ kind: 'denied' });
    else if (info.ours && hasApp) finish(info.code);
    else setStage({ kind: 'elsewhere' });
  }, [profile, info, hasApp]);

  const leave = () => {
    clearStravaReturn(profile?.onboarded ? '#/settings' : '');
    onDone();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.code ?? '');
      setCopied(true);
    } catch {
      // Blocked; the code is selectable.
    }
  };

  let icon: IconName = 'refresh';
  let title = 'Connecting to Strava…';
  let body: ReactNode = 'Signing in and fetching your recent activities.';
  let actions: ReactNode = null;

  if (stage.kind === 'done') {
    icon = 'check';
    title = stage.athlete ? `Connected as ${stage.athlete}` : 'Connected to Strava';
    body =
      stage.added > 0
        ? `${stage.added} ${stage.added === 1 ? 'activity' : 'activities'} from the last two months synced. New ones come in whenever you open Overload.`
        : 'Nothing to sync from the last two months yet. New activities come in whenever you open Overload.';
    actions = (
      <button type="button" className="btn primary block lg" onClick={leave}>
        Continue
      </button>
    );
  } else if (stage.kind === 'error') {
    icon = 'info';
    title = "Couldn't connect";
    body = stage.message;
    actions = (
      <button type="button" className="btn primary block lg" onClick={leave}>
        Back to settings
      </button>
    );
  } else if (stage.kind === 'denied') {
    icon = 'x';
    title = 'Strava access not granted';
    body = 'Nothing was connected. You can try again from Settings → Strava.';
    actions = (
      <button type="button" className="btn primary block lg" onClick={leave}>
        Back to Overload
      </button>
    );
  } else if (stage.kind === 'elsewhere') {
    icon = 'run';
    title = 'One more step';
    body = (
      <>
        Strava sent you back to a different browser from the one Overload keeps your data in. That's normal for an app added to the home screen. Copy this
        code, open Overload, and paste it in <strong>Settings → Strava</strong>.
      </>
    );
    actions = (
      <>
        <div className="sr-code">
          <code>{info.code}</code>
          <button type="button" className="btn primary block lg" onClick={() => void copy()}>
            <Icon name={copied ? 'check' : 'copy'} size={18} />
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
        {hasApp && info.code && (
          <button type="button" className="btn ghost block" onClick={() => finish(info.code!)}>
            Finish connecting in this browser instead
          </button>
        )}
      </>
    );
  }

  return (
    <main className="sr" aria-busy={stage.kind === 'working'}>
      <div className="empty sr-card" role={stage.kind === 'error' ? 'alert' : undefined}>
        <span className={`empty-icon${stage.kind === 'working' ? ' sr-spin' : ''}`} aria-hidden="true">
          <Icon name={icon} size={28} />
        </span>
        <h1>{title}</h1>
        <p>{body}</p>
        {actions && <div className="stack sr-actions">{actions}</div>}
      </div>
    </main>
  );
}
