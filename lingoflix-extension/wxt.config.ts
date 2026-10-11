import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  // Toolbar/extension icons generated from the logo (spec §5.10).
  autoIcons: { baseIconPath: 'assets/icon.svg' },
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'LingoFlix: Understand every line on Netflix',
    short_name: 'LingoFlix',
    description:
      'Understand every line on Netflix: custom shortcuts, subtitle toggle and AI explanations. Not affiliated with Netflix.',
    permissions: ['storage', 'unlimitedStorage', 'alarms'],
    // Reminders spec §7: asked for only when the learner turns reminders on.
    optional_permissions: ['notifications'],
    // Free-own-key spec §4.7: the AI providers too, so the background's requests don't depend on their CORS.
    host_permissions: ['https://www.netflix.com/*', 'https://api.anthropic.com/*', 'https://api.openai.com/*'],
    // Premium spec §7.8: the Chrome Web Store item's public key, so every build (unpacked too) has the store's
    // extension ID, gdgblbcjeocifdhjfbpjpkcphlfmaoll, which the website hands sessions to.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+I0ka9EAb8zBfMzTGLviK2aBk0y6phAw7GpDexn/9A4rtMK3wBy8IVWgv+Vm2uk+xnNlUBDTYZX8rH5K12JDxTKqtMsXAYOLhankg7fJmAw25RrhI+7M36c2xHpX/Pr+qXRehGLPkBRDx+35jaBp1Gx013bG9Cgf3bNVuUmxhpR4eUdspVkj/CebCvtxLDZF6IQAuvd6S+ie2ZWK4+/37mAktgkSYMewgRXu+qr/ur0f7W24zXS3gRNnOpOHcSrgeWJGCVVWE/iC1R2LXCelsQWhvctxwrUDU3CAbGh4Xb2wPu5CU+f1/gTMBKCjWpi7owwC8Z3pKCgRATLo95BGAwIDAQAB',
  },
});
