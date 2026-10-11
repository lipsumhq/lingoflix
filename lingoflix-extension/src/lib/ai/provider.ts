// The content script, options page and popup use this module: never import an SDK here.

/** Whose API a key calls (free-own-key spec §3.1). Never stored: read from the key each time. */
export type Provider = 'claude' | 'openai';

export interface ProviderInfo {
  /** The name in learner-facing copy: "Claude is busy right now". */
  name: string;
  /** The company that bills the key: "Anthropic rejected this key." */
  company: string;
  /** The one model LingoFlix uses with this provider, saved on each explanation (spec §4.8). */
  model: string;
  /** The console's address, as copy shows it. */
  console: string;
  /** Where the learner creates a key. */
  keysUrl: string;
  /** Where the learner adds credit. */
  billingUrl: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  claude: {
    name: 'Claude',
    company: 'Anthropic',
    model: 'claude-sonnet-5-5',
    console: 'console.anthropic.com',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    billingUrl: 'https://console.anthropic.com/settings/billing',
  },
  openai: {
    name: 'OpenAI',
    company: 'OpenAI',
    model: 'gpt-6.1-sol',
    console: 'platform.openai.com',
    keysUrl: 'https://platform.openai.com/api-keys',
    billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
  },
};

/**
 * Spec §3.1: `sk-ant-` is Claude, any other `sk-` is OpenAI, anything else neither. OpenAI doesn't document
 * its key formats, so only the prefix is checked; Test key is the real check.
 */
export function providerOf(key: string): Provider | null {
  const trimmed = key.trim();
  if (trimmed.startsWith('sk-ant-')) return 'claude';
  if (trimmed.startsWith('sk-')) return 'openai';
  return null;
}

/** Spec §3.2: what Save and Test key say about a key that is neither. */
export const NOT_A_KEY = "This doesn't look like a Claude or OpenAI key.";
