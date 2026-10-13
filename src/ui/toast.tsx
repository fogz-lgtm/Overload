import { useSyncExternalStore } from 'react';
import { Icon, type IconName } from '../components/Icon';

interface Toast {
  id: number;
  text: string;
  icon?: IconName;
  tone?: 'default' | 'accent';
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a short confirmation at the top of the screen. */
export function toast(text: string, opts: { icon?: IconName; tone?: Toast['tone']; ms?: number } = {}): void {
  const t: Toast = { id: nextId++, text, icon: opts.icon, tone: opts.tone };
  toasts = [...toasts, t].slice(-3);
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, opts.ms ?? 2600);
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'accent' ? ' accent' : ''}`}>
          {t.icon && <Icon name={t.icon} size={18} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
