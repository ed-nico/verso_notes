# Verso Notes

**A local-first notebook for Markdown.** Verso is a desktop app that stores everything as plain `.md` files on your disk — a mesh of [Obsidian](https://obsidian.md) (document editing, wikilinks, graph) and [Logseq](https://logseq.com) (block outliner, backlinks, daily journal). No accounts, no cloud, no lock-in. Your notes are just files you own.

<img width="3386" height="1992" alt="CleanShot 2026-06-27 at 07 13 15@2x" src="https://github.com/user-attachments/assets/3ca7340f-3476-40aa-9f4f-8cd0907bb42d" />

- **Files first.** Plain Markdown on disk is the source of truth. No proprietary format, no lock-in.
- **Local first.** It works fully offline. Bring your own sync (iCloud, Dropbox, Git, Syncthing…).

## Features

- **📝 Block outliner editor** — a fast, keyboard-first outliner: indent/outdent, fold, drag-reorder, multi-select, and Markdown shortcuts (`#` headings, `-`/`1.` lists, todos, ```` ``` ```` code, `|` tables). A `/` command menu and `[[`-autocomplete keep your hands on the keyboard.
- **🔗 Wikilinks & backlinks** — `[[Note]]` and `[[Folder/Note]]` with autocomplete and click-to-navigate. Every note shows its linked **and** unlinked references.
- **🗃 Bases** — Obsidian-style database tables and galleries over your notes' frontmatter. Filter, sort, and group; embed a saved view inline with `{{base …}}`.
- **🏷 Tags & Supertags** — inline `#tags` plus Tana-style **typed tags**: declare a field schema and any note carrying that tag becomes a structured entity.
- **✅ Todos** — write todos in any note; add a due date with `@2026-06-20`. A Todos view rolls them up into Overdue / Today / Upcoming.
- **🗓 Daily journal** — a calendar and per-day notes, with an **On This Day** panel that surfaces entries from the same date in previous years.
- **📄 PDF annotator** — open a PDF in a side pane, highlight text, and have each highlight flow back into your note as a linkable reference.
- **🧩 Queries & templates** — `{{query …}}` blocks (`#tag`, `[[Page]]`, todo/done) and reusable note templates.
- **📚 Multiple vaults** — open several folders and swap between them from the sidebar.
- **🕸 Graph** — a force-directed graph of the whole vault, plus a compact local graph of the current note's neighbours.
- **📝 Canvas/Whiteboard** - Like to have a different perspective, canvas has you covered.

Everything is local. Per-vault data (like saved Bases) lives inside the vault itself, so moving or syncing the folder takes your setup with it.

## Works with your existing vault

Point Verso at any folder of Markdown files, including an existing **Obsidian** vault. It reads and writes the same plain `.md` files with YAML frontmatter and `[[wikilinks]]`, and keeps its own settings in a `.verso/` folder inside the vault, so it won't disturb your `.obsidian/` configuration. Nothing is imported or converted -  quit Verso and your notes are exactly where they always were.

## Install

Grab the latest release from the [Releases](https://github.com/ed-nico/verso_notes/releases) page:

- **macOS** (Apple Silicon) — download the `.dmg` and drag Verso into Applications.
  The app isn't notarized yet (no $99/yr Apple developer account), so macOS will say
  it "is damaged" on first open. It isn't — that's Gatekeeper flagging any
  non-notarized download. Clear it once with:

  ```bash
  xattr -cr /Applications/Verso.app
  ```

  …or build from source below, which needs no workaround.
- **Linux** (x64) — download the `.AppImage`, `chmod +x` it, and run.
- **Windows** (x64) — download and run `Verso-Setup-*.exe`. The installer is unsigned,
  so SmartScreen shows "Windows protected your PC" once: click **More info → Run anyway**.

Or build from source:

```bash
git clone https://github.com/ed-nico/verso_notes.git
cd verso_notes
npm install
npm run dev          # run in development with hot reload
npm run build:mac    # or: package a .dmg (Apple Silicon)
npm run build:linux  # or: package a Linux AppImage
npm run build:win    # or: package a Windows installer
```

On first launch, click **Open a folder** and point it at your own Markdown folder.

## Showcase

<img width="2312" height="2004" alt="CleanShot 2026-06-27 at 07 14 36@2x" src="https://github.com/user-attachments/assets/0726cf8f-f039-4818-be0b-561343515ca9" />

<img width="2794" height="1836" alt="CleanShot 2026-06-27 at 08 24 34@2x" src="https://github.com/user-attachments/assets/12e2dd83-c1f2-4699-b921-babb933ff84e" />

<img width="1710" height="1368" alt="image" src="https://github.com/user-attachments/assets/cb1b2145-67d2-4396-9e69-57a3bb8ba6c9" />

## Contributing

Bug reports and ideas are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, checks (`npm run typecheck` + `npm test`), and architecture notes.

## Privacy

Verso has **no telemetry, no analytics, no accounts, and no update pings**, and it never opens a network port. 

The app only touches the network to display things your notes embed (remote images, YouTube/Vimeo/Loom links), to open links you click, and, optionally, to fetch a pasted URL's page title ("smart link titles", one request to that URL; toggle it off in Settings). Spellcheck runs from a bundled dictionary, fully offline. 

Don't just take my word for it, it's all in this repo.

## Status

Verso is in active development, so expect rough edges and the occasional breaking change. Issues and ideas welcome.

No mobile yet (although being worked on).

<img width="2302" height="1962" alt="CleanShot 2026-06-27 at 07 15 01@2x" src="https://github.com/user-attachments/assets/02836a55-1fdc-466a-90dc-6f68a1273032" />

## Built with AI

Full transparency: this app was largely written with AI assistance. I use Verso daily as my own notes app, and it works well for my needs — but treat it accordingly: keep backups of your vault (your notes are plain Markdown files, so any backup or sync tool works), and review the code at your free will — it's all here.

## License

[MIT](LICENSE). The code is free to use, modify, and redistribute; the **Verso** name and logo are not covered by the license — please ship forks under a different name.
