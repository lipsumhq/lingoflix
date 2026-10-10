import { browser } from '#imports';

export function App() {
  return (
    <main className="w-80 bg-neutral-950 p-4 text-neutral-100">
      <header className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">LingoFlix</h1>
        <span className="text-xs text-neutral-500">v{browser.runtime.getManifest().version}</span>
      </header>
    </main>
  );
}
