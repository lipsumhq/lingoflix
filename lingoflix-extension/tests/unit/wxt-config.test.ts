import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';

describe('the extension manifest', () => {
  it('may call Netflix, Anthropic and OpenAI (free-own-key spec §4.7), and nothing else', () => {
    const manifest = config.manifest as { host_permissions?: string[] };
    expect(manifest.host_permissions).toEqual(['https://www.netflix.com/*', 'https://api.anthropic.com/*', 'https://api.openai.com/*']);
  });
});
