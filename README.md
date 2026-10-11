# LingoFlix

Understand every line on Netflix. LingoFlix is a free, open-source Chrome extension for
studying languages with Netflix:

- **Explain any line.** Hover a subtitle (or press E) and Claude explains what it means in this
  scene, the key expressions, and how to use them, using the surrounding dialogue. Ask follow-up
  questions right in the card.
- **Study Log.** Claude suggests the words, phrases, idioms and lines worth keeping from each line it
  explains; save the ones you want. Browse them by show, season and episode, filter and search them,
  open any one to see the scene and the explanation, jump back to that moment on Netflix, and export
  to Anki or CSV (or a full backup you can import again).
- **Line by line.** Jump to the previous or next line (A / D), replay the current one (R), or make
  ← / → move by line instead of seconds.
- **Your keys.** Rewind/forward by the seconds you choose, hide subtitles with one key, and remap
  every shortcut.
- **Study reminders.** Pick the days and a time, and LingoFlix reminds you to study with Netflix.
  It skips the days you've already watched. Off until you turn it on.

LingoFlix uses your own Claude API key (you pay Anthropic directly for what you use). The key and
your Study Log stay on your computer. Only when you ask for an explanation or a follow-up does
LingoFlix send Anthropic the line, the show and episode it's from, the dialogue around it, the
episode's earlier subtitle lines (you can turn this off in Settings), and a list of your recent
saved items and explained lines (with the show and episode each is from), so Claude can build on it.
If you turn on study reminders, LingoFlix keeps the date you last watched and that show's name on your
computer, to skip days you've watched and to offer the show; it never leaves your computer.

Not affiliated with or endorsed by Netflix.

## Development

```bash
pnpm install
pnpm test        # unit tests
pnpm compile     # type-check
pnpm build       # production build → .output/chrome-mv3
```

To try it on Netflix, load the build into your normal Chrome profile (WXT's dev browser
has no Netflix login or DRM): `chrome://extensions` → Developer mode → **Load unpacked** →
select `.output/chrome-mv3`. After rebuilding, press the reload icon on the extension card
and refresh the Netflix tab.

## Support

LingoFlix is free. If it helps you learn, you can support it:
[Buy Me a Coffee](https://buymeacoffee.com/jaycho1214) ·
[GitHub Sponsors](https://github.com/sponsors/jaycho1214)

## License

[MIT](./LICENSE)
