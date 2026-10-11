import { describe, expect, it } from 'vitest';
import { NOT_A_KEY, PROVIDERS, providerOf } from '@/lib/ai/provider';

describe('providerOf (free-own-key spec §3.1)', () => {
  it('reads Claude from sk-ant- keys', () => {
    expect(providerOf('sk-ant-api03-abcdefghijklmnop-wxyz')).toBe('claude');
    expect(providerOf('sk-ant-admin01-abcdef')).toBe('claude'); // an admin key: Test key is the real check
  });

  it('reads OpenAI from every other sk- key', () => {
    expect(providerOf('sk-proj-abcdefghijklmnop')).toBe('openai');
    expect(providerOf('sk-svcacct-abcdefghijklmnop')).toBe('openai');
    expect(providerOf('sk-abcdefghijklmnop')).toBe('openai'); // a legacy user key
    expect(providerOf('sk-admin-abcdef')).toBe('openai');
  });

  it('trims the key first', () => {
    expect(providerOf('  sk-ant-api03-key \n')).toBe('claude');
    expect(providerOf('\tsk-proj-key ')).toBe('openai');
  });

  it('is null for anything else', () => {
    for (const key of ['', '   ', 'sk', 'sk_live_abc', 'SK-ANT-api03', 'ant-api03-abc', 'pk-abc', 'api-key', 'x sk-ant-api03']) {
      expect(providerOf(key)).toBeNull();
    }
  });
});

describe('PROVIDERS', () => {
  it('names, model, and key and billing pages of each provider', () => {
    expect(PROVIDERS).toEqual({
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
    });
  });

  it('says what a refused key is', () => {
    expect(NOT_A_KEY).toBe("This doesn't look like a Claude or OpenAI key.");
  });
});
