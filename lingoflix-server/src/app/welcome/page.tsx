import type { Metadata } from "next";

export const metadata: Metadata = { title: "Welcome" };

const SHORTCUTS: [string, string][] = [
  ["Explain the current line", "E"],
  ["Go to the previous or next line", "A / D"],
  ["Replay the current line", "R"],
  ["Hide or show subtitles", "C"],
];

/** Where each provider makes API keys (the same pages the extension's Settings card links to). */
const ANTHROPIC_KEYS_URL = "https://console.anthropic.com/settings/keys";
const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";

export default function WelcomePage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-4xl font-black tracking-tight">Thanks for installing LingoFlix</h1>
        <p className="max-w-2xl text-lg text-mute">Open any show on Netflix, turn on subtitles, and try these keys.</p>
      </section>

      <section aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading" className="text-2xl font-black">
          Main shortcuts
        </h2>
        <table className="mt-4 w-full max-w-xl border-collapse text-left">
          <caption className="sr-only">Main shortcuts</caption>
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col" className="py-2 pr-4">
                Action
              </th>
              <th scope="col" className="py-2">
                Key
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(([action, key]) => (
              <tr key={action} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 font-semibold">
                  {action}
                </th>
                <td className="py-2">
                  <kbd className="rounded-lg border-2 border-b-4 border-line px-2 py-0.5 font-black">{key}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-mute">{"You can change every key in LingoFlix's settings."}</p>
      </section>

      <section aria-labelledby="key-heading" className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8">
        <h2 id="key-heading" className="text-2xl font-black">
          Add your key
        </h2>
        <ol className="mt-3 list-decimal space-y-1 pl-6 font-semibold">
          <li>
            Get an API key from Anthropic (
            <a href={ANTHROPIC_KEYS_URL} className="underline">
              console.anthropic.com
            </a>
            ) or OpenAI (
            <a href={OPENAI_KEYS_URL} className="underline">
              platform.openai.com
            </a>
            ).
          </li>
          <li>{"Click the LingoFlix icon in Chrome's toolbar, then Add your API key."}</li>
          <li>Paste the key, press Save, then Test key.</li>
        </ol>
        <p className="mt-4">Usage is billed by Anthropic or OpenAI. Your key stays on this computer.</p>
      </section>
    </div>
  );
}
