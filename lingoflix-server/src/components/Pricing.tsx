import Link from "next/link";
import { PRICE_MONTHLY, PRICE_YEARLY, TRIAL_DAYS } from "@/lib/site";
import { primaryButton } from "./styles";

const PREMIUM_INCLUDES = [
  "Hover any line for an explanation that fits the scene",
  "Ask follow-up questions about any line",
  "Save suggestions for words, phrases, idioms and whole lines",
  "Anki and CSV export of your Study Log",
];

export function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8 sm:px-10"
    >
      <h2 id="pricing-heading" className="text-3xl font-black">
        LingoFlix Premium
      </h2>
      <p className="mt-2 text-lg font-bold">{`${TRIAL_DAYS} days free, then ${PRICE_MONTHLY}/month or ${PRICE_YEARLY}/year.`}</p>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {PREMIUM_INCLUDES.map((item) => (
          <li key={item} className="rounded-xl bg-card px-4 py-3 font-semibold">
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link href="/upgrade" className={primaryButton}>
          {`Start your ${TRIAL_DAYS}-day free trial`}
        </Link>
        <p className="text-sm text-mute">{"Cancel any time before the trial ends and you won't be charged."}</p>
      </div>
    </section>
  );
}
