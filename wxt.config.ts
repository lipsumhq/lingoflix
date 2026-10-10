import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'LingoFlix — Understand every line on Netflix',
    short_name: 'LingoFlix',
    description:
      'Understand every line on Netflix: custom shortcuts, subtitle toggle and AI explanations. Not affiliated with Netflix.',
    permissions: ['storage'],
  },
});
