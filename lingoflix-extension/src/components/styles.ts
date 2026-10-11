/** Shared class strings for the Duolingo-style controls (spec §5.10). Colors come from tokens in tailwind.css. */

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const pressable = 'transition-transform active:translate-y-[3px] active:shadow-none disabled:translate-y-0';

export const buttonPrimary = `inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-[15px] font-extrabold tracking-wider text-on-brand uppercase shadow-[0_4px_0_var(--lf-brand-edge)] hover:brightness-105 ${pressable} ${focusRing}`;

export const buttonSecondary = `inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-line bg-card px-3 py-2 text-xs font-extrabold tracking-wider text-ink uppercase shadow-[0_3px_0_var(--lf-line)] hover:bg-soft ${pressable} ${focusRing}`;

/** Small square button with a thick bottom edge, e.g. the stepper's – and +. */
export const buttonMini = `grid size-7 place-items-center rounded-lg border-2 border-b-4 border-line bg-card text-ink hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40 ${pressable} ${focusRing}`;

export const card = 'rounded-[18px] border-2 border-line bg-card';

/** Keyboard key look for shortcut bindings. */
export const keycap = `grid h-11 min-w-12 place-items-center rounded-xl border-2 border-b-[5px] border-line bg-card px-3 text-lg font-black text-ink hover:bg-soft ${focusRing}`;

/** Yellow icon square in front of a settings row. */
export const iconTile = 'grid size-11 shrink-0 place-items-center rounded-xl border-2 border-tint-line bg-tint text-tint-ink';
