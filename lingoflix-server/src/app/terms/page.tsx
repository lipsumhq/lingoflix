import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Terms of service</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 11, 2026</p>
      </header>

      <section>
        <h2 className="text-2xl font-black">Free, as is</h2>
        <p className="mt-2">LingoFlix is free and provided as is, without warranty.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">What you need</h2>
        <p className="mt-2">You need your own Netflix subscription and your own Claude or OpenAI API key.</p>
        <p className="mt-2">Anthropic or OpenAI bills you for what your key uses, under its own terms.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">AI answers</h2>
        <p className="mt-2">AI answers can be wrong.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Not affiliated</h2>
        <p className="mt-2">{"LingoFlix isn't affiliated with Netflix, Anthropic or OpenAI."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Donations</h2>
        <p className="mt-2">Donations are voluntary and unlock nothing.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Changes and contact</h2>
        <p className="mt-2">These terms may change. The date at the top shows when they last did.</p>
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
