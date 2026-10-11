import { primaryButton } from "./styles";

/** The store button. Until the listing exists (no URL), a plain "coming soon" label instead of a dead link. */
export function AddToChrome({ storeUrl }: { storeUrl: string | null }) {
  if (!storeUrl) {
    return (
      <span className="inline-flex items-center rounded-2xl border-2 border-line px-5 py-3 font-extrabold text-mute">
        Coming soon to the Chrome Web Store
      </span>
    );
  }
  return (
    <a href={storeUrl} className={primaryButton}>
      Add to Chrome
    </a>
  );
}
