# Verso-Notes

**A local-first notebook for Markdown.** Verso is a desktop app that stores everything as
plain `.md` files on your disk — a mesh of [Obsidian](https://obsidian.md) (document
editing, wikilinks, graph) and [Logseq](https://logseq.com) (block outliner, backlinks,
daily journal). No accounts, no cloud, no lock-in. Your notes are just files you own.

<img width="3386" height="1992" alt="CleanShot 2026-06-27 at 07 13 15@2x" src="https://github.com/user-attachments/assets/3ca7340f-3476-40aa-9f4f-8cd0907bb42d" />

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

Everything is local. Per-vault data (like saved Bases) lives inside the vault itself, so moving or syncing the folder takes your setup with it.

<img width="2312" height="2004" alt="CleanShot 2026-06-27 at 07 14 36@2x" src="https://github.com/user-attachments/assets/0726cf8f-f039-4818-be0b-561343515ca9" />
<img width="2794" height="1836" alt="CleanShot 2026-06-27 at 08 24 34@2x" src="https://github.com/user-attachments/assets/12e2dd83-c1f2-4699-b921-babb933ff84e" />
<img width="1710" height="1368" alt="image" src="https://github.com/user-attachments/assets/cb1b2145-67d2-4396-9e69-57a3bb8ba6c9" />

## Philosophy

- **Files first.** Plain Markdown on disk is the source of truth. No database, no proprietary format, no lock-in.
- **Local first.** It works fully offline. Bring your own sync (iCloud, Dropbox, Git, Syncthing…).
- **Keyboard first.** The outliner, command menu, and quick switcher are built for speed.

## Status

Verso is in active development (currently `v0.11.x`) and pre-1.0 — expect rough edges and the occasional breaking change. Issues and ideas welcome.

<img width="2302" height="1962" alt="CleanShot 2026-06-27 at 07 15 01@2x" src="https://github.com/user-attachments/assets/02836a55-1fdc-466a-90dc-6f68a1273032" />

No Mobile yet.

## License

[MIT](LICENSE)
