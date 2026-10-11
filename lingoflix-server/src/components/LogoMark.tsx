/** The LingoFlix mark (same paths as public/icon.svg), drawn inline so it needs no image request. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path d="M7 4h18a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H15l-6 5v-5H7a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5z" fill="#ffc800" />
      <path d="M13.5 9.5v9l7.5-4.5z" fill="#3a2e00" />
    </svg>
  );
}
