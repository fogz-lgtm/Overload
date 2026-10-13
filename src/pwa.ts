import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

// A new deploy waits in the background until the lifter taps the banner, so
// the app never reloads in the middle of a set.
let ready = false;
const listeners = new Set<() => void>();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    ready = true;
    listeners.forEach((l) => l());
  },
  onRegisteredSW(_url, registration) {
    // An installed app can stay open for days; look for new deploys hourly.
    if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
  },
});

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => ready,
  );
}

export function applyUpdate(): void {
  void updateSW(true);
}
