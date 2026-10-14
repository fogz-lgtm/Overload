import type { CSSProperties } from 'react';
import type { DayType } from '../engine/types';

/** Short labels for pills and week grids. */
export const DAY_SHORT: Record<DayType, string> = {
  full: 'Full',
  upper: 'Upper',
  lower: 'Lower',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shldr',
  arms: 'Arms',
  core: 'Core',
};

/** Session-tag colour per day type: pushing, pulling, legs, everything else. */
export const DAY_COLOR: Record<DayType, string> = {
  full: 'var(--tag-full)',
  upper: 'var(--tag-pull)',
  lower: 'var(--tag-legs)',
  push: 'var(--tag-push)',
  pull: 'var(--tag-pull)',
  legs: 'var(--tag-legs)',
  chest: 'var(--tag-push)',
  back: 'var(--tag-pull)',
  shoulders: 'var(--tag-push)',
  arms: 'var(--tag-full)',
  core: 'var(--tag-full)',
};

export const dayStyle = (d: DayType) => ({ '--tag-color': DAY_COLOR[d] }) as CSSProperties;
