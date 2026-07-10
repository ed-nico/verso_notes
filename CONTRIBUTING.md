# Contributing to Verso

Thanks for your interest! Verso is a local-first Markdown notebook built with
Electron + React 19. This guide covers what you need to work on it.

## Getting started

```bash
npm install
npm run dev        # launch the app with HMR
```

On first launch, click **Open a folder** and choose the bundled `sample-vault/` —
an interlinked set of demo notes that exercises every feature.

## Checks

There is **no linter**. Before opening a PR, run both:

```bash
npm run typecheck  # tsc --noEmit on BOTH tsconfig.node.json and tsconfig.web.json
npm test           # vitest over the parsing/indexing libs (src/**/*.test.ts)
```

TypeScript is `strict`. CI runs typecheck + tests + a production build on every PR.

## A note on naming: Verso vs. inkwell

The product is branded **Verso**, but internal identifiers use **inkwell** (the
project's original name): the preload bridge is `window.inkwell` (typed
`InkwellApi`), the asset protocol is `inkwell://`, and prefs live in
`inkwell-prefs.json`. This is deliberate — renaming them would break existing
installs. **Keep using `inkwell` for internal identifiers; use `Verso` only for
user-facing strings.**

## Architecture in one paragraph

Three Electron contexts: the renderer (React, `src/renderer/`) **never touches the
filesystem** — everything crosses the preload bridge (`src/preload/index.ts`,
exposed as `window.inkwell`) into the main process (`src/main/index.ts` for IPC and
window plumbing, `src/main/workspace.ts` for all disk access, scoped to the chosen
vault root). The renderer's heart is a single Zustand store
(`src/renderer/src/store.ts`) holding raw text, parsed notes, and a vault index —
read its header comments before changing renderer behavior.

### Adding an IPC method — touch four files, in order

1. `src/shared/types.ts` — add it to `InkwellApi` (the cross-process contract)
2. `src/preload/index.ts` — forward it over `ipcRenderer.invoke`
3. `src/main/index.ts` — handle it in `registerIpc`
4. `src/main/workspace.ts` — the actual disk logic (if it touches files)

### Other conventions

- Import aliases: `@/*` → `src/renderer/src/*`, `@shared/*` → `src/shared/*`.
- All renderer-initiated disk writes go through the store's `queueWrite` — never
  call `window.inkwell.writeNote` directly from store actions.
- Assets shown in notes are served through the `inkwell://` protocol; the renderer
  can't read files by path.
- Match the surrounding code's comment density and style.

## Building distributables

```bash
npm run build:mac    # Apple Silicon .dmg (ad-hoc signed)
npm run build:linux  # Linux x64 AppImage
```

## Reporting bugs

Open an issue with your platform, what you did, what happened, and — if it's a
file-sync or data problem — whether another app (Obsidian, a sync client) was
touching the vault at the same time.
