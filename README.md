# LingoFlix

Understand every line on Netflix. LingoFlix is a free, open-source Chrome extension for
studying languages with Netflix:

- **Explain any line.** Hover a subtitle (or press E) and Claude explains what it means in this
  scene, the key expressions, and how to use them, using the surrounding dialogue. Ask follow-up
  questions right in the card.
- **Study Log.** Every explanation is saved on your computer, organized by show, season, and episode.
  Jump back to any line with one click.
- **Line by line.** Jump to the previous or next line (A / D), replay the current one (R), or make
  ← / → move by line instead of seconds.
- **Your keys.** Rewind/forward by the seconds you choose, hide subtitles with one key, and remap
  every shortcut.

LingoFlix uses your own Claude API key (you pay Anthropic directly for what you use). The key and
your Study Log stay on your computer; subtitle text is sent to Anthropic only when you ask for an
explanation.

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
