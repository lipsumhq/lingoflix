# LingoFlix

Understand every line on Netflix. LingoFlix is a free, open-source Chrome extension for
studying languages with Netflix: remappable rewind/forward shortcuts, a one-key subtitle
toggle, and (coming next) AI explanations of any subtitle line with your own Claude API key.

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
