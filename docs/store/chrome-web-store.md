# Chrome Web Store listing

What the LingoFlix item in the Chrome Web Store developer dashboard says, field by field, so the listing and the
extension stay in step. The package comes from `pnpm --filter lingoflix-extension zip:store`
(`lingoflix-extension/.output/store/lingoflix-extension-<version>-chrome.zip`); its manifest supplies the title and
the summary. Images are in [`../assets/store/`](../assets/store): the store icon (`icon-128.png`), the five 1280x800 screenshots in
order, and the small (440x280) and marquee (1400x560) promo tiles.

## Store listing

**Category:** Education · **Language:** English

**Homepage URL:** https://lingoflix.lipsum.fun · **Support URL:** https://lingoflix.lipsum.fun

**Mature content:** no

**Description:**

```text
Learn a language with the shows you already love. Hover a subtitle on Netflix, or press E, and LingoFlix explains that line: what it means in this scene, the words and expressions worth knowing, and how to use them yourself.

EXPLAIN ANY LINE
• See what a line really means here, using the dialogue around it, not a dictionary guess.
• Learn the key words, phrases and idioms, with examples you can reuse.
• Ask follow-up questions right in the card.
• Answers keep going if you close the card, and a line you've explained before opens instantly, at no cost.

STUDY LOG
• Save the words, phrases, idioms and lines you want to keep, straight from the card.
• Browse them by show, season and episode, or filter and search.
• Open any item to see its scene and explanation, and jump back to that moment on Netflix.
• Export to Anki or CSV, or make a full backup you can import again.

LINE BY LINE
• Jump to the previous or next subtitle line (A / D) and replay the current one (R).
• Make ← / → move by line instead of by seconds, or pick how many seconds they skip.
• Hide subtitles with one key (C), and remap every shortcut.

STUDY REMINDERS
• Pick the days and a time, and LingoFlix reminds you to study with Netflix. It skips the days you've already watched. Off until you turn it on.

YOUR KEY, YOUR DATA
LingoFlix is free. It uses your own API key from Anthropic (Claude) or OpenAI, and you pay them directly for what you use. Your key, your Study Log and your settings stay on your computer. Only when you ask for an explanation or a follow-up does LingoFlix send the line, the dialogue around it, the show and episode, and your recent saved items, straight from your browser to Anthropic or OpenAI, never through a LingoFlix server. No accounts, no ads, no tracking.

WHAT YOU NEED
• Chrome on a computer and a Netflix account.
• For explanations: an API key from console.anthropic.com or platform.openai.com.

Privacy policy: https://lingoflix.lipsum.fun/privacy

LingoFlix is free. If it helps you learn, you can support it at buymeacoffee.com/jaycho1214 or github.com/sponsors/jaycho1214.

LingoFlix is not affiliated with or endorsed by Netflix, Anthropic or OpenAI.
```

## Privacy

**Single purpose:**

```text
LingoFlix helps people learn a language while they watch Netflix: it explains the subtitle lines they choose, keeps the words and phrases they save in a Study Log, and adds line-by-line playback shortcuts to the Netflix player.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps the user's settings, shortcuts, API key, Study Log (saved items and explanations) and reminder schedule on their computer. |
| `unlimitedStorage` | The Study Log keeps every explanation and saved item on the user's computer for as long as they want, which over months of study can outgrow the default local storage quota. |
| `alarms` | Schedules the optional study reminders for the days and time the user picks. |
| `notifications` (optional) | Shows the optional study reminder. Chrome asks for it only when the user turns reminders on. |
| Host permission (one field for all three hosts) | `https://www.netflix.com/*`: reads the subtitles on Netflix watch pages so it can explain the line the user picks, and adds the explanation card and the line-by-line shortcuts to the player. `https://api.anthropic.com/*` and `https://api.openai.com/*`: sends the user's explanation and follow-up requests from the background, with the user's own API key, to Anthropic or OpenAI (whichever the key belongs to). Nothing else is requested from any other host. |

**Remote code:** No, I am not using remote code. Every script is in the package.

**Data usage:** the item handles

- **Website content:** the subtitle line, the dialogue around it, the show and episode, and the user's recent saved items go to Anthropic or OpenAI when the user asks for an explanation or a follow-up.
- **Authentication information:** the user's own Anthropic or OpenAI API key is sent to that company with each request.

Nothing else. All three certifications hold: no selling or transferring data outside the approved use cases, no use
unrelated to the single purpose, no use for creditworthiness or lending.

**Privacy policy URL:** https://lingoflix.lipsum.fun/privacy

## Distribution

Free, no in-app purchases · Visibility: Public · Regions: all

## Test instructions

```text
No LingoFlix account is needed. Testing needs a Netflix account.

1. Open any title on netflix.com (https://www.netflix.com/watch/...) and turn subtitles on.
2. Line by line: press D for the next subtitle line, A for the previous one, R to replay the current one, C to hide or show subtitles. These work without an API key.
3. Explanations need an API key from Anthropic (console.anthropic.com) or OpenAI (platform.openai.com). Open LingoFlix's options page (click the LingoFlix icon, then Settings) and paste the key. On Netflix, hover a subtitle line or press E: a card explains the line and suggests items to save. Without a key, the card says how to add one.
4. Saved items appear in the options page's Study Log tab, where they can be browsed, opened and exported (Export menu: Anki, CSV or backup).
```
