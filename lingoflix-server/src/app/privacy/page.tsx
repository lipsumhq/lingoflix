import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy" };

const ANTHROPIC_PRIVACY_URL = "https://www.anthropic.com/legal/privacy";
const OPENAI_PRIVACY_URL = "https://openai.com/policies/privacy-policy/";

/** What the extension sends with each explanation or follow-up (free-own-key spec §5.6). */
const SENT = [
  "The line and the dialogue around it.",
  "The show and episode.",
  'The story so far, if "Send the story so far" is on.',
  "Your recent saved items and explained lines.",
];

const SERVICES: [string, string][] = [
  ["Anthropic or OpenAI", "(your own account) write the explanations and answers."],
  ["Vercel", "hosts this site."],
  ["Neon", "hosts its database."],
  ["Cloudflare", "forwards email sent to support."],
];

export default function PrivacyPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 11, 2026</p>
      </header>

      <section aria-labelledby="computer-heading">
        <h2 id="computer-heading" className="text-2xl font-black">
          On your computer only
        </h2>
        <p className="mt-2">
          Your Study Log, settings, reminders (including the show you last watched) and your API key stay on your
          computer.
        </p>
        <p className="mt-2">LingoFlix has no accounts, and this site sets no cookies.</p>
      </section>

      <section aria-labelledby="explanations-heading">
        <h2 id="explanations-heading" className="text-2xl font-black">
          When you ask for an explanation
        </h2>
        <p className="mt-2">
          {
            "When you ask for an explanation or a follow-up, the extension sends these straight from your browser to Anthropic or OpenAI (whichever your key belongs to), with your key and never through LingoFlix's server:"
          }
        </p>
        <ul className="mt-2 list-disc pl-6">
          {SENT.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-2">Requests to OpenAI ask it not to store them.</p>
        <p className="mt-2">
          <a href={ANTHROPIC_PRIVACY_URL} className="font-bold underline">
            {"Anthropic's privacy policy"}
          </a>{" "}
          and{" "}
          <a href={OPENAI_PRIVACY_URL} className="font-bold underline">
            {"OpenAI's privacy policy"}
          </a>{" "}
          apply.
        </p>
      </section>

      <section aria-labelledby="keeps-heading">
        <h2 id="keeps-heading" className="text-2xl font-black">
          What this site keeps
        </h2>
        <p className="mt-2">
          Only your optional answer on the uninstall page: the reason, the comment and the time, with no IP address or
          account.
        </p>
      </section>

      <section aria-labelledby="services-heading">
        <h2 id="services-heading" className="text-2xl font-black">
          Services
        </h2>
        <ul className="mt-2 list-disc pl-6">
          {SERVICES.map(([name, role]) => (
            <li key={name}>
              <strong>{name}</strong> {role}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="text-2xl font-black">
          Contact
        </h2>
        <p className="mt-2">
          Questions? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </article>
  );
}
