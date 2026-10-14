import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { haptics } from '../ui/haptics';
import { Icon, type IconName } from './Icon';
import './SwipeRow.css';

export interface SwipeAction {
  label: string;
  icon: IconName;
  tone: 'accent' | 'danger';
  onClick: () => void;
}

const ACTION_W = 76;
/** How far the finger travels before it's a swipe and not a tap or a scroll. */
const SLOP = 10;
/** Past this share of the row's width, letting go runs the first action. */
const FULL = 0.55;

const SEEN_KEY = 'overload.swipeSeen';
const seenListeners = new Set<() => void>();

function swipeSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSwiped() {
  if (swipeSeen()) return;
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode: the hint just keeps showing.
  }
  seenListeners.forEach((l) => l());
}

/** A one-line hint that rows can be swiped, until the first swipe. */
export function SwipeHint({ text }: { text: string }) {
  const [hidden, setHidden] = useState(swipeSeen);
  useEffect(() => {
    const l = () => setHidden(true);
    seenListeners.add(l);
    return () => void seenListeners.delete(l);
  }, []);
  if (hidden) return null;
  return (
    <p className="swipe-hint small">
      <Icon name="swap" size={14} />
      <span>{text}</span>
    </p>
  );
}

// One row open at a time.
let openRow: { id: string; close: () => void } | null = null;
const closeOthers = (id: string) => {
  if (openRow && openRow.id !== id) openRow.close();
};

/**
 * A row that slides left to reveal actions, like Mail on iPhone. Swipe past
 * halfway to run the first action straight away. Taps still reach the row
 * itself, so everything here also works without swiping.
 */
export function SwipeRow({ children, actions, onSwipe }: { children: ReactNode; actions: SwipeAction[]; onSwipe?: () => void }) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ x0: number; y0: number; base: number; mode: 'pending' | 'drag' | 'scroll'; offset: number; armed: boolean } | null>(null);
  /** Until when a click is the tail end of a swipe, not a tap. */
  const swallowUntil = useRef(0);
  const openWidth = ACTION_W * actions.length;

  const paint = (offset: number, animate: boolean, armed = false) => {
    const front = frontRef.current;
    const back = backRef.current;
    if (!front || !back) return;
    front.style.transition = back.style.transition = animate ? '' : 'none';
    front.style.transform = offset ? `translateX(${offset}px)` : '';
    back.style.width = `${Math.max(0, -offset)}px`;
    back.classList.toggle('armed', armed);
  };

  const close = () => {
    paint(0, true);
    setOpen(false);
    if (openRow?.id === id) openRow = null;
  };

  const show = () => {
    markSwiped();
    closeOthers(id);
    openRow = { id, close };
    paint(-openWidth, true);
    setOpen(true);
  };

  // An open row closes when anything else is touched.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  });

  useEffect(
    () => () => {
      if (openRow?.id === id) openRow = null;
    },
    [id],
  );

  return (
    <div ref={rootRef} className="swipe" data-open={open || undefined}>
      <div ref={backRef} className="swipe-back" aria-hidden={!open} id={`${id}-actions`}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`swipe-act ${a.tone}`}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              close();
              a.onClick();
            }}
          >
            <Icon name={a.icon} size={19} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={frontRef}
        className="swipe-front"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x0: e.clientX, y0: e.clientY, base: open ? -openWidth : 0, mode: 'pending', offset: open ? -openWidth : 0, armed: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.mode === 'scroll') return;
          const dx = e.clientX - d.x0;
          const dy = e.clientY - d.y0;
          if (d.mode === 'pending') {
            if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
              d.mode = 'scroll';
              return;
            }
            if (Math.abs(dx) < SLOP) return;
            d.mode = 'drag';
            frontRef.current?.setPointerCapture(e.pointerId);
            closeOthers(id);
          }
          const width = rootRef.current?.clientWidth ?? 320;
          let offset = Math.min(0, d.base + dx);
          // Past the full width it resists, like a rubber band.
          if (offset < -width) offset = -width - (-offset - width) * 0.25;
          const armed = !!onSwipe && -offset > width * FULL;
          if (armed !== d.armed) haptics.tap();
          d.offset = offset;
          d.armed = armed;
          paint(offset, false, armed);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.mode !== 'drag') return;
          swallowUntil.current = performance.now() + 400;
          if (d.armed && onSwipe) {
            markSwiped();
            close();
            onSwipe();
          } else if (-d.offset > openWidth / 2) show();
          else close();
        }}
        onPointerCancel={() => {
          if (drag.current?.mode === 'drag') close();
          drag.current = null;
        }}
        onClickCapture={(e) => {
          // The click after a swipe, or a tap that closes an open row, goes no further.
          if (performance.now() < swallowUntil.current) {
            e.preventDefault();
            e.stopPropagation();
            swallowUntil.current = 0;
          } else if (open) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
