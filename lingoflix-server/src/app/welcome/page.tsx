import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/styles";
import { TRIAL_DAYS } from "@/lib/site";

export const metadata: Metadata = { title: "Welcome" };

const SHORTCUTS: [string, string][] = [
  ["Explain the current line", "E"],
  ["Go to the previous or next line", "A / D"],
  ["Replay the current line", "R"],
  ["Hide or show subtitles", "C"],
  ["Save the line to your Study Log", "B"],
];

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

      <section aria-labelledby="premium-heading" className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8">
        <h2 id="premium-heading" className="text-2xl font-black">
          Explanations are part of Premium
        </h2>
        <p className="mt-2 font-semibold">{`Try every Premium feature free for ${TRIAL_DAYS} days.`}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/upgrade" className={primaryButton}>
            {`Start your ${TRIAL_DAYS}-day free trial`}
          </Link>
          <Link href="/sign-in?next=%2Fconnect" className={secondaryButton}>
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
