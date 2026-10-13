import { applyUpdate, useUpdateReady } from '../pwa';

export function UpdateBanner() {
  if (!useUpdateReady()) return null;
  return (
    <button type="button" className="update-banner" onClick={applyUpdate}>
      Update ready — tap to refresh
    </button>
  );
}
