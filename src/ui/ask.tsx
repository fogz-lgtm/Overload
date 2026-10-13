import { useRef, useSyncExternalStore } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';

interface AskOptions {
  title: string;
  body?: string;
  confirm: string;
  cancel?: string;
  tone?: 'danger' | 'default';
  icon?: IconName;
}

let pending: (AskOptions & { resolve: (ok: boolean) => void }) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** In-app confirmation sheet; resolves true when confirmed. Replaces window.confirm. */
export function ask(opts: AskOptions): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...opts, resolve };
    emit();
  });
}

export function AskHost() {
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
  );
  const answer = useRef(false);
  if (!current) return null;
  const danger = current.tone === 'danger';
  return (
    <Sheet
      open
      title={current.title}
      onClose={() => {
        const ok = answer.current;
        answer.current = false;
        pending = null;
        emit();
        current.resolve(ok);
      }}
    >
      {(close) => (
        <div className="stack lg">
          {current.body && <p className="muted">{current.body}</p>}
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn grow" onClick={close}>
              {current.cancel ?? 'Cancel'}
            </button>
            <button
              type="button"
              data-ask="confirm"
              className={`btn grow ${danger ? 'danger-fill' : 'primary'}`}
              onClick={() => {
                answer.current = true;
                close();
              }}
            >
              {current.icon && <Icon name={current.icon} size={18} />}
              {current.confirm}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
