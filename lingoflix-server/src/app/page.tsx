import { AddToChrome } from "@/components/AddToChrome";
import { Pricing } from "@/components/Pricing";
import { secondaryButton } from "@/components/styles";
import { chromeStoreUrl } from "@/lib/site";

const FEATURES = [
  {
    title: "Explain any line",
    body: "Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them.",
  },
  {
    title: "Save what you learn",
    body: "Keep words, phrases, idioms and whole lines in your Study Log, organized by show, season and episode.",
  },
  {
    title: "Line by line",
    body: "Jump to the previous or next line, replay the current one, or hide subtitles to test your ears.",
  },
  {
    title: "Voice shadowing",
    body: "Coming soon: record yourself saying a line and compare it with the original. Your recording never leaves your computer.",
  },
  {
    title: "Study reminders",
    body: "Pick the days and a time, and LingoFlix reminds you to study with Netflix.",
  },
];

/** Spec §3, row by row: [feature, Free, Premium]. */
const PLAN_ROWS: [string, string, string][] = [
  ["Shortcuts, line navigation and the subtitle toggle", "Yes", "Yes"],
  ["Voice shadowing (coming soon)", "Yes", "Yes"],
  ["Study reminders", "Yes", "Yes"],
  ["Study Log: browse, search, open and delete", "Yes", "Yes"],
  ["Save this line", "Yes", "Yes"],
  ["Full backup and import", "Yes", "Yes"],
  ["AI explanations, follow-ups and save suggestions", "No", "Yes"],
  ["Anki and CSV export", "No", "Yes"],
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col items-start gap-5">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Understand every line on Netflix</h1>
        <p className="max-w-2xl text-lg text-mute">
          LingoFlix is a Chrome extension for learning languages with the shows you already watch.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <AddToChrome storeUrl={chromeStoreUrl()} />
          <a href="#pricing" className={secondaryButton}>
            See pricing
          </a>
        </div>
      </section>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="text-2xl font-black">
          What LingoFlix does
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-2xl border-2 border-line px-5 py-4">
              <h3 className="text-lg font-extrabold">{feature.title}</h3>
              <p className="mt-1 text-mute">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="text-2xl font-black">
          Free and Premium
        </h2>
        <table className="mt-5 w-full border-collapse text-left">
          <caption className="sr-only">Free and Premium</caption>
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col" className="py-2 pr-4">
                Feature
              </th>
              <th scope="col" className="py-2 pr-4">
                Free
              </th>
              <th scope="col" className="py-2">
                Premium
              </th>
            </tr>
          </thead>
          <tbody>
            {PLAN_ROWS.map(([feature, free, premium]) => (
              <tr key={feature} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 font-semibold">
                  {feature}
                </th>
                <td className="py-2 pr-4">{free}</td>
                <td className="py-2">{premium}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Pricing />
    </div>
  );
}
