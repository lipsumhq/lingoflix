import { AddToChrome } from "@/components/AddToChrome";
import { secondaryButton } from "@/components/styles";
import { DONATION_LINKS, chromeStoreUrl } from "@/lib/site";

const FEATURES = [
  {
    title: "Explain any line",
    body: "Hover a subtitle or press E. LingoFlix explains what it means in this scene, the key expressions, and how to use them, with your own Claude or OpenAI key.",
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

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col items-start gap-5">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Understand every line on Netflix</h1>
        <p className="max-w-2xl text-lg text-mute">
          LingoFlix is a Chrome extension for learning languages with the shows you already watch.
        </p>
        <AddToChrome storeUrl={chromeStoreUrl()} />
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

      <section
        aria-labelledby="free-heading"
        className="rounded-3xl border-2 border-tint-line bg-tint px-6 py-8 sm:px-10"
      >
        <h2 id="free-heading" className="text-2xl font-black">
          Free, with your own key
        </h2>
        <p className="mt-2 max-w-2xl text-lg">
          {
            "LingoFlix is free. Explanations use your own Claude or OpenAI API key, so they're billed by Anthropic or OpenAI at their prices. Everything else costs nothing."
          }
        </p>
      </section>

      <section id="support" aria-labelledby="support-heading">
        <h2 id="support-heading" className="text-2xl font-black">
          Support LingoFlix
        </h2>
        <p className="mt-2 text-mute">If LingoFlix helps you learn, you can support it.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {DONATION_LINKS.map((link) => (
            <a key={link.id} href={link.url} className={secondaryButton}>
              {link.label}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
