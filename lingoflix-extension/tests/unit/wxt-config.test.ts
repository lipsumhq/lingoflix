import { afterEach, describe, expect, it, vi } from 'vitest';

type Manifest = { host_permissions?: string[]; key?: string };

/** The config as `wxt build` (unpacked) or `pnpm zip:store` (LINGOFLIX_STORE=1) loads it. */
async function loadConfig({ store }: { store: boolean }) {
  vi.resetModules();
  if (store) vi.stubEnv('LINGOFLIX_STORE', '1');
  const { default: config } = await import('../../wxt.config');
  return { outDir: config.outDir, manifest: (config.manifest as () => Manifest)() };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the extension manifest', () => {
  it('may call Netflix, Anthropic and OpenAI (free-own-key spec §4.7), and nothing else', async () => {
    const { manifest } = await loadConfig({ store: false });
    expect(manifest.host_permissions).toEqual(['https://www.netflix.com/*', 'https://api.anthropic.com/*', 'https://api.openai.com/*']);
  });

  it("keeps the store's public key in unpacked builds, so they have the store's extension ID", async () => {
    const { outDir, manifest } = await loadConfig({ store: false });
    expect(manifest.key).toMatch(/^MIIBIjANBgkq/);
    expect(outDir).toBeUndefined();
  });

  it('leaves the key out of the store build, which the Chrome Web Store rejects, and builds it in its own folder', async () => {
    const { outDir, manifest } = await loadConfig({ store: true });
    expect(manifest).not.toHaveProperty('key');
    expect(manifest.host_permissions).toHaveLength(3);
    expect(outDir).toBe('.output/store');
  });
});
