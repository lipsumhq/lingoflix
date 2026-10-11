import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy" };

const SERVICES: [string, string][] = [
  ["Anthropic", "writes the explanations and answers."],
  ["Stripe", "handles payments. We never see your card number."],
  ["Vercel", "runs our website and server."],
  ["Neon", "hosts our database."],
  ["Cloudflare", "sends the sign-in emails."],
];

export default function PrivacyPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 10, 2026</p>
      </header>

      <p>LingoFlix keeps as little as it can. Your Study Log, settings and reminders stay on your computer.</p>

      <section>
        <h2 className="text-2xl font-black">What stays on your computer</h2>
        <ul className="mt-2 list-disc pl-6">
          <li>Your Study Log: saved words, phrases, idioms and lines, and the explanations you asked for.</li>
          <li>Your settings, including your shortcuts.</li>
          <li>Your reminder settings and, while reminders are on, the date you last watched and that show.</li>
        </ul>
        <p className="mt-2">{"The free features work without an account and don't send anything to our server."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">What our server receives</h2>
        <p className="mt-2">
          Only when you use a Premium feature (asking for an explanation or a follow-up), the extension sends our server
          the subtitle line, the dialogue around it, the show and episode, the earlier lines of the episode if &quot;Send
          the story so far&quot; is on, and a list of your recent saved items and explained lines. Our server passes this
          to Anthropic to write the answer and does not keep it.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">What we keep</h2>
        <ul className="mt-2 list-disc pl-6">
          <li>Your account: your email address and how you sign in (Google or an email link).</li>
          <li>
            {
              "While you're signed in: the IP address and browser of each sign-in, to keep your account secure. Signing out removes them."
            }
          </li>
          <li>If you sign in with Google: your name, profile picture and the sign-in tokens Google gives us.</li>
          <li>Your subscription status, which Stripe sends us.</li>
          <li>
            For each AI answer: when it was made, what kind it was, which AI model wrote it, and how many tokens it used.
            Never the subtitle text, your questions or the answers.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-black">Services we use</h2>
        <ul className="mt-2 list-disc pl-6">
          {SERVICES.map(([name, role]) => (
            <li key={name}>
              <strong>{name}</strong> {role}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-black">When you uninstall</h2>
        <p className="mt-2">
          {
            "If you answer the optional question on the goodbye page, we store your answer with the time and nothing else: no account, no IP address. Uninstalling doesn't delete your account; email us and we will."
          }
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Contact</h2>
        <p className="mt-2">
          Questions, or want your account deleted? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </article>
  );
}
