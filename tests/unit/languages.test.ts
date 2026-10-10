import { describe, expect, it } from 'vitest';
import { EXPLANATION_LANGUAGES, getExplanationLanguage, isExplanationLanguage, languageForUi } from '@/lib/languages';

describe('explanation languages', () => {
  it('offers about 30 languages with unique codes and native names', () => {
    expect(EXPLANATION_LANGUAGES.length).toBe(30);
    expect(new Set(EXPLANATION_LANGUAGES.map((l) => l.code)).size).toBe(30);
    expect(getExplanationLanguage('ko')).toEqual({ code: 'ko', nativeName: '한국어', englishName: 'Korean' });
  });

  it('maps a browser UI language to the closest supported one', () => {
    expect(languageForUi('ko-KR')).toBe('ko');
    expect(languageForUi('en_US')).toBe('en');
    expect(languageForUi('zh-TW')).toBe('zh-Hant');
    expect(languageForUi('zh-CN')).toBe('zh-Hans');
    expect(languageForUi('zh')).toBe('zh-Hans');
    expect(languageForUi('pt')).toBe('pt-BR');
    expect(languageForUi('pt-PT')).toBe('pt-PT');
    expect(languageForUi('nb-NO')).toBe('no');
    expect(languageForUi('fr-CA')).toBe('fr');
  });

  it('falls back to English for unknown or empty input', () => {
    expect(languageForUi('xx-YY')).toBe('en');
    expect(languageForUi('')).toBe('en');
    expect(getExplanationLanguage('klingon').code).toBe('en');
  });

  it('recognizes only listed codes', () => {
    expect(isExplanationLanguage('ja')).toBe(true);
    expect(isExplanationLanguage('JA')).toBe(false);
    expect(isExplanationLanguage(42)).toBe(false);
  });
});
