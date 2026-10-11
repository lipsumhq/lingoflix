import type { Metadata } from "next";
import { PRICE_MONTHLY, PRICE_YEARLY, SUPPORT_EMAIL, TRIAL_DAYS } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6 leading-relaxed">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Terms of service</h1>
        <p className="mt-2 text-sm text-mute">Last updated: October 10, 2026</p>
      </header>

      <section>
        <h2 className="text-2xl font-black">LingoFlix Premium</h2>
        <p className="mt-2">
          {`Premium costs ${PRICE_MONTHLY}/month or ${PRICE_YEARLY}/year, billed by Stripe in US dollars. It includes AI explanations, follow-up questions, save suggestions, and Anki and CSV export.`}
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Free trial</h2>
        <p className="mt-2">
          {`New accounts can try Premium free for ${TRIAL_DAYS} days, once per account. You enter a card when the trial starts. Unless you cancel before the trial ends, your subscription starts and you're charged.`}
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Renewal and cancellation</h2>
        <p className="mt-2">
          Your plan renews automatically each month or year. You can cancel any time from your account page (Manage
          subscription), and Premium stays on until the end of the period you paid for.
        </p>
        <p className="mt-2">{"Uninstalling the extension doesn't cancel your subscription."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Refunds</h2>
        <p className="mt-2">{"If you were charged and didn't use Premium, email us within 14 days and we'll refund you."}</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Fair use</h2>
        <p className="mt-2">
          After heavy use in a billing period, answers may come from a faster model until your next billing date.
        </p>
        <p className="mt-2">To keep LingoFlix working for everyone, there is also a daily limit on AI answers.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">AI answers</h2>
        <p className="mt-2">
          Explanations are written by AI and can be wrong. Use them to learn, not as a professional translation.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Netflix</h2>
        <p className="mt-2">LingoFlix is not affiliated with or endorsed by Netflix.</p>
        <p className="mt-2">You need your own Netflix subscription to use LingoFlix.</p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Changes and contact</h2>
        <p className="mt-2">We may update these terms. The new version will be posted here with its date.</p>
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
