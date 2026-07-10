# Verso — brand assets

The mark is a **graph "V"**: three linked nodes (two periwinkle, one mint) forming both the
letter V and the app's wikilink graph. Colors come straight from the app theme — accent
`#7c8cff`, mint `#6fcaa8`, dark `#1a1a1e`.

| File | Size | Use |
|------|------|-----|
| `icon.svg` / `icon.png` | 1024² | App icon (squircle). Copied to `../build/icon.png` so electron-builder generates the `.icns`/`.ico`. |
| `icon-512.png` / `icon-256.png` | 512² / 256² | Favicon, smaller app contexts. |
| `logo-wordmark.svg` / `.png` | 2560×760, transparent | Mark + "Verso" lockup. Works on dark backgrounds. |
| `x-header.png` | 3000×1000 | X / Twitter profile **header banner** (1500×500 @2x). |
| `x-card-editor.png` | 3200×1800 | X post image — the outliner with wikilinks, todos & backlinks. |
| `x-card-graph.png` | 3200×1800 | X post image — the force-directed graph view. |

## Posting to X
- **Profile photo:** `icon-512.png` (X crops to a circle — the mark stays centered).
- **Header:** `x-header.png`.
- **Launch/feature posts:** attach `x-card-editor.png` and/or `x-card-graph.png` (16:9, render
  crisp in-timeline).

## Regenerating
SVGs are the source. Re-render with headless Chrome:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --force-device-scale-factor=2 --default-background-color=00000000 \
  --screenshot=out.png --window-size=1600,900 "$(pwd)/x-card-editor.svg"
```
