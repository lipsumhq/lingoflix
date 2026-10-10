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
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: ['https://www.netflix.com/*', 'https://api.anthropic.com/*'],
  },
});
