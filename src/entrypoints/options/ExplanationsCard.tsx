import { useId } from 'react';
import { Toggle } from '@/components/Toggle';
import { card } from '@/components/styles';
import { EXPLANATION_LANGUAGES } from '@/lib/languages';
import { CARD_SECTION_IDS, type CardSections, type Settings } from '@/lib/settings';

const SECTION_COPY: Record<keyof CardSections, { label: string; description: string }> = {
  meaning: { label: 'Meaning', description: 'Translation, tone, and nuance in this scene.' },
  keyExpressions: { label: 'Key expressions', description: 'Idioms and slang, each defined.' },
  howToUse: { label: 'How to use it', description: 'Everyday example sentences.' },
  followUp: { label: 'Follow-up box', description: 'Ask Claude more about the line.' },
};

interface ExplanationsCardProps {
  settings: Settings;
  update(fn: (s: Settings) => Settings): Promise<void>;
}

/** Spec §5.8: explanation language, card sections, Pause on hover. */
export function ExplanationsCard({ settings, update }: ExplanationsCardProps) {
  const languageId = useId();
  const languageHint = useId();
  return (
    <section aria-labelledby="explanations-heading" className={`${card} px-5 py-4`}>
      <h2 id="explanations-heading" className="text-[19px] font-black">
        Explanations
      </h2>
      <p className="mt-0.5 text-sm font-semibold text-mute">How the card on Netflix explains a line.</p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <label htmlFor={languageId} className="block text-base font-extrabold">
            Explain in
          </label>
          <p id={languageHint} className="text-[13px] font-semibold text-mute">
            Claude answers in this language.
          </p>
        </div>
        <select
          id={languageId}
          aria-describedby={languageHint}
          value={settings.explanationLanguage}
          onChange={(e) => {
            // Read the value now: React resets the controlled select before the async update runs.
            const explanationLanguage = e.target.value;
            void update((s) => ({ ...s, explanationLanguage }));
          }}
          className="rounded-xl border-2 border-line bg-card px-3 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
        >
          {EXPLANATION_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t-2 border-soft py-3">
        <Toggle
          label="Pause on hover"
          description="Pause the video while you read the card."
          checked={settings.pauseOnHover}
          onChange={(pauseOnHover) => void update((s) => ({ ...s, pauseOnHover }))}
        />
      </div>

      <fieldset className="border-t-2 border-soft pt-3">
        <legend className="sr-only">Card sections</legend>
        <p className="text-base font-extrabold">Card sections</p>
        <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {CARD_SECTION_IDS.map((id) => (
            <Toggle
              key={id}
              label={SECTION_COPY[id].label}
              description={SECTION_COPY[id].description}
              checked={settings.cardSections[id]}
              onChange={(on) => void update((s) => ({ ...s, cardSections: { ...s.cardSections, [id]: on } }))}
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}
