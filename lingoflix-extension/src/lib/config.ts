export const DONATION_LINKS = [
  { id: 'buymeacoffee', label: 'Buy Me a Coffee', shortLabel: 'Coffee', url: 'https://buymeacoffee.com/jaycho1214' },
  { id: 'github-sponsors', label: 'GitHub Sponsors', shortLabel: 'Sponsor', url: 'https://github.com/sponsors/jaycho1214' },
] as const;

/** LingoFlix's site: the install and uninstall pages (free-own-key spec §4.7). */
export const SITE_URL = 'https://lingoflix.lipsum.fun';

/** The public repository, linked from the options page so anyone can read what LingoFlix sends, and where. */
export const SOURCE_CODE_URL = 'https://github.com/lipsumhq/lingoflix';
export const SOURCE_TITLE = 'Open source';
export const SOURCE_COPY = 'Read the code and see what LingoFlix sends, and where.';

export const DONATION_TITLE = 'Enjoying LingoFlix?';
export const DONATION_COPY = "It's free forever. A coffee keeps it going.";

/** Follow-up answers (main spec §7.1); any thinking counts toward it. */
export const CLAUDE_MAX_TOKENS = 2048;
/** Explanations: room for the JSON reply with its suggestions (v2 spec §5.1), and any thinking. */
export const CLAUDE_EXPLAIN_MAX_TOKENS = 4096;
/** Explaining a line is content writing: low effort keeps the card's first words quick (Sonnet 5.5 thinks at medium and up). */
export const CLAUDE_EFFORT = 'low';
export const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';
/** OpenAI: one limit for explanations and follow-ups; reasoning tokens count toward it (free-own-key spec §4.3). */
export const OPENAI_MAX_OUTPUT_TOKENS = 8000;
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
/** Spec §7.4: a stream with no event this long is treated as a network failure (free-own-key spec §4.3). */
export const AI_IDLE_TIMEOUT_MS = 30_000;
/** Finish-answers spec §3.4: under Chrome's 30 s idle limit for an extension's background. */
export const KEEP_ALIVE_MS = 25_000;
