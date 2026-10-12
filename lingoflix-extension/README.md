# LingoFlix extension

The LingoFlix Chrome extension. What it does, privacy and license: see the [repository README](../README.md).

## Development

Run from this folder (or from the repository root, which runs every package):

```bash
pnpm install
pnpm test        # unit tests
pnpm compile     # type-check
pnpm build       # production build → .output/chrome-mv3
pnpm zip:store   # Chrome Web Store zip, without the manifest key → .output/store/
```

To try it on Netflix, load the build into your normal Chrome profile (WXT's dev browser
has no Netflix login or DRM): `chrome://extensions` → Developer mode → **Load unpacked** →
select `lingoflix-extension/.output/chrome-mv3`. After rebuilding, press the reload icon on the
extension card and refresh the Netflix tab.

`scripts/` holds the probe scripts used to check Netflix's player internals
(see [`docs/netflix-internals.md`](../docs/netflix-internals.md)).
