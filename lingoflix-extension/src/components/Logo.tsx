/** Speech bubble with a play button: subtitles + video. Same artwork as src/assets/icon.svg. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="shrink-0">
      <path d="M7 4h18a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H15l-6 5v-5H7a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5z" fill="#ffc800" />
      <path d="M13.5 9.5v9l7.5-4.5z" fill="#3a2e00" />
    </svg>
  );
}

export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={`flex items-center gap-2 font-black tracking-tight text-ink ${large ? 'text-[22px]' : 'text-xl'}`}>
      <LogoMark size={large ? 32 : 30} />
      LingoFlix
    </span>
  );
}
