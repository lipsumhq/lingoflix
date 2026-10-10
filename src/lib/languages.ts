export interface ExplanationLanguage {
  /** BCP 47 code stored in settings and in Study Log entries. */
  code: string;
  nativeName: string;
  englishName: string;
}

/** Languages Claude explains in (spec §5.8), shown by native name. */
export const EXPLANATION_LANGUAGES: readonly ExplanationLanguage[] = [
  { code: 'en', nativeName: 'English', englishName: 'English' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish' },
  { code: 'fr', nativeName: 'Français', englishName: 'French' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Brazilian Portuguese' },
  { code: 'pt-PT', nativeName: 'Português (Portugal)', englishName: 'European Portuguese' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish' },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish' },
  { code: 'no', nativeName: 'Norsk', englishName: 'Norwegian' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish' },
  { code: 'cs', nativeName: 'Čeština', englishName: 'Czech' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian' },
  { code: 'uk', nativeName: 'Українська', englishName: 'Ukrainian' },
  { code: 'el', nativeName: 'Ελληνικά', englishName: 'Greek' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic' },
  { code: 'he', nativeName: 'עברית', englishName: 'Hebrew' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian' },
  { code: 'ms', nativeName: 'Bahasa Melayu', englishName: 'Malay' },
  { code: 'fil', nativeName: 'Filipino', englishName: 'Filipino' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean' },
  { code: 'zh-Hans', nativeName: '简体中文', englishName: 'Simplified Chinese' },
  { code: 'zh-Hant', nativeName: '繁體中文', englishName: 'Traditional Chinese' },
];

const BY_LOWER_CODE = new Map(EXPLANATION_LANGUAGES.map((l) => [l.code.toLowerCase(), l.code]));

/** Browser tags that don't match a listed code directly. */
const ALIASES: Record<string, string> = {
  pt: 'pt-BR',
  nb: 'no',
  nn: 'no',
  tl: 'fil',
  iw: 'he',
  in: 'id',
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
};

const lookup = (tag: string): string | undefined => BY_LOWER_CODE.get(tag) ?? ALIASES[tag];

export function isExplanationLanguage(code: unknown): code is string {
  return typeof code === 'string' && EXPLANATION_LANGUAGES.some((l) => l.code === code);
}

/** Closest supported language for a browser UI language such as "ko-KR" or "zh-TW"; English otherwise. */
export function languageForUi(uiLanguage: string): string {
  const tag = uiLanguage.trim().replace(/_/g, '-').toLowerCase();
  if (!tag) return 'en';
  return lookup(tag) ?? lookup(tag.split('-')[0]!) ?? 'en';
}

export function getExplanationLanguage(code: string): ExplanationLanguage {
  return EXPLANATION_LANGUAGES.find((l) => l.code === code) ?? EXPLANATION_LANGUAGES[0]!;
}
