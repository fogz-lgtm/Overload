import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Bottom sheet. Closes on backdrop tap, Escape, the close button, or a
 * downward drag from the top edge, animating out before it unmounts.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Pass a function to get an animated `close` for buttons inside the sheet. */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [closing, setClosing] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  const requestClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 200);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && requestClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, requestClose]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!sheet.current || sheet.current.scrollTop > 0) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !sheet.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    drag.current.dy = dy;
    sheet.current.style.transition = 'none';
    sheet.current.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sheet.current) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.t);
    sheet.current.style.transition = '';
    if (d.dy > 110 || velocity > 0.6) requestClose();
    else sheet.current.style.transform = '';
  };

  return (
    <div className="sheet-backdrop" onClick={requestClose} style={closing ? { opacity: 0, transition: 'opacity 200ms' } : undefined}>
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={closing ? { transform: 'translateY(100%)', transition: 'transform 200ms ease-in' } : undefined}
      >
        <div className="sheet-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="sheet-handle" />
          {title && (
            <div className="sheet-head">
              <div className="grow">
                <h2>{title}</h2>
                {subtitle && <p className="small faint" style={{ marginTop: 3 }}>{subtitle}</p>}
              </div>
              <button type="button" className="icon-btn sm" onClick={requestClose} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
          )}
        </div>
        {typeof children === 'function' ? children(requestClose) : children}
      </div>
    </div>
  );
}
