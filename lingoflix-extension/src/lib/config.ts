export const DONATION_LINKS = [
  { id: 'buymeacoffee', label: 'Buy Me a Coffee', shortLabel: 'Coffee', url: 'https://buymeacoffee.com/jaycho1214' },
  { id: 'github-sponsors', label: 'GitHub Sponsors', shortLabel: 'Sponsor', url: 'https://github.com/sponsors/jaycho1214' },
] as const;

export const DONATION_TITLE = 'Enjoying LingoFlix?';
export const DONATION_COPY = "It's free forever. A coffee keeps it going.";

/** Follow-up answers (main spec §7.1). */
export const CLAUDE_MAX_TOKENS = 1024;
/** Explanations: room for the suggest_saves call after the text (v2 spec §5.1). */
export const CLAUDE_EXPLAIN_MAX_TOKENS = 1536;
export const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';
/** Spec §7.4: a stream silent this long is treated as a network failure. */
export const CLAUDE_IDLE_TIMEOUT_MS = 30_000;
/** Where users create an API key. */
export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
