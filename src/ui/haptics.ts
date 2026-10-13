// Vibration API is Android-only; iOS Safari silently ignores it.
const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw when called without a user gesture.
  }
};

export const haptics = {
  tap: () => buzz(8),
  success: () => buzz([12, 40, 18]),
  alarm: () => buzz([180, 80, 180, 80, 260]),
};
