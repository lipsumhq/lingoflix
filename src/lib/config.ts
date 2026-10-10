export const DONATION_LINKS = [
  { id: 'buymeacoffee', label: 'Buy Me a Coffee', shortLabel: 'Coffee', url: 'https://buymeacoffee.com/jaycho1214' },
  { id: 'github-sponsors', label: 'GitHub Sponsors', shortLabel: 'Sponsor', url: 'https://github.com/sponsors/jaycho1214' },
] as const;

export const DONATION_TITLE = 'Enjoying LingoFlix?';
export const DONATION_COPY = "It's free forever. A coffee keeps it going.";

/** Spec §7.1: one constant for the model. */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_MAX_TOKENS = 1024;
export const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';
/** Spec §7.4: a stream silent this long is treated as a network failure. */
export const CLAUDE_IDLE_TIMEOUT_MS = 30_000;
/** Where users create an API key. */
export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
