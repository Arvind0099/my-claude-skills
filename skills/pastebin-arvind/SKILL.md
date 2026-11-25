---
name: pastebin-arvind
description: Publish text, code, logs, reports, tables or whole HTML/SVG pages to the owner's N4 Paste pastebin (pastebin.arvind.eu.org) and return a shareable link. Use when the user says "paste this", "put it on my pastebin", "make a shareable link", "share this as a link", "host this HTML", "give me a live link to this page", or when a result is too long or too structured for chat (a log excerpt, a password/ID sheet, a table, a report, a diff). Covers the API, the languages and expiry options, the 10 MiB limit, live rendering of HTML and SVG (render=true, /live/<id>) and its sandbox limits, what the code view can and cannot show, and how to lay text out so it looks good there.
---

# pastebin-arvind

Publishes text to **N4 Paste** - the owner's pastebin at <https://pastebin.arvind.eu.org> - and gives back a link
anyone can open. HTML and SVG can also be opened as live pages. Built and maintained with credit to
[@N4pst3rX](https://t.me/N4pst3rX). Full API reference: <https://pastebin.arvind.eu.org/docs> (JSON at `/api`).

## When to use it

- The user asks for a paste, a pastebin link, or "something I can share".
- The user wants an HTML page, demo, report or SVG **opened in a browser from a link** - publish it and give the live link.
- Output is long, tabular or log-like and would be clumsy in chat.
- A system needs a **link to text** (a Telegram caption over its length limit, a bug report, a job report).

Do **not** use it for secrets the user hasn't explicitly said may be shared (see *Privacy*).

## Quick start

```bash
python scripts/paste.py report.txt --title "Weekly report" --expires 7d       # a file
python scripts/paste.py page.html --title "Demo" --live                        # HTML -> live page link
some-command | python scripts/paste.py - --title "Build log" --lang bash       # stdin
python scripts/paste.py sheet.txt --verify                                     # read it back and compare
```

The script prints the page link on stdout (hints and errors go to stderr). Options: `--title`, `--lang`,
`--expires` (`never` `1h` `24h` `7d` `30d`), `--raw` (raw-text link), `--live` (live page link, HTML/SVG only),
`--json` (full API answer), `--verify`. Set `PASTEBIN_URL` to use a different instance. Standard library only -
nothing to install.

Without Python, call the API directly:

```bash
curl -s -X POST https://pastebin.arvind.eu.org/api/pastes \
  -H "content-type: application/json" \
  --data '{"title":"My paste","language":"text","content":"hello","expiresIn":"never"}'
```

## The API

`POST /api/pastes` with JSON `{ content, title?, language?, expiresIn? }`

| field | notes |
|---|---|
| `content` | required, UTF-8 text. Empty -> HTTP 400 `Paste cannot be empty`. |
| `title` | optional; shown as the page heading, cut to 100 characters. |
| `language` | optional. Left out, the server detects `html`, `svg` or `text`. Known: `text html svg css scss javascript typescript json python bash sql rust go java c cpp csharp php ruby swift kotlin yaml toml xml markdown dockerfile graphql`. An unknown value is accepted and only shown as a label. |
| `expiresIn` | `never` (default), `1h`, `24h`, `7d`, `30d`, or a number of seconds. Any other text silently becomes `never`. |

Answer (HTTP 201): `{ "id", "url", "rawUrl", "renderUrl", "expiresAt" }`

- `url` - the code view (for HTML/SVG it has a Preview tab; add `#preview` to open on it)
- `rawUrl` - `/r/<id>`, plain text
- `renderUrl` - `/live/<id>`, the live page, or `null` when the paste is not HTML or SVG
- `expiresAt` - ISO time or `null`

| read | gives |
|---|---|
| `GET /live/<id>` | live page (short link to share) |
| `GET /raw?id=<id>&render=true` | same live page through the raw endpoint |
| `GET /r/<id>?render=true` | same live page |
| `GET /r/<id>` | plain text |
| `GET /raw?id=<id>` | encrypted blob as stored (the default) |
| `GET /raw?id=<id>&dec=true` | decrypted paste as JSON |
| `GET /api/pastes/<id>` | decrypted paste as JSON |
| `/?fork=<id>` | editor filled in with a copy |

**Limits (tested in production 2026-11-25):** up to **10 MiB** works; larger answers HTTP 413. There is **no delete or
edit endpoint** (`DELETE` answers 405), so choose an expiry for anything you may want gone. An expired paste answers
404 on every endpoint, including `/raw`.

## Live pages (HTML and SVG)

A paste renders when its language is `html` or `svg`, or when it is `text`/`xml` that starts with HTML or SVG markup.
Asking to render anything else falls back to plain text (header `x-rendered: false`). Markdown is **not** rendered -
convert it to HTML first.

What works: inline and CDN scripts and styles, web fonts, images by URL or `data:`, forms, pop-ups, downloads, and
`fetch` to APIs that allow any origin (CORS `*`). Fragments get a doctype, a title and a mobile viewport added.

What doesn't, because every page runs in a sandbox with a private origin:

- `localStorage` / `sessionStorage` work but are in memory only - nothing survives a reload. Cookies are ignored.
- No IndexedDB or service workers, and no camera, microphone or location.
- APIs that only allow specific origins refuse the request (the page's origin is `null`).
- Relative links to other files don't resolve: a paste is **one file**, so inline the CSS, JS and small images.
- Pages are marked `noindex`.

Don't publish pages that imitate another site's login or collect passwords or payment details.

## What the code view can show - and what it can't

The normal page (`url`) is a **code viewer**: your text in a monospace block with line numbers.

- Markdown and HTML show as source there. For a formatted result, publish HTML and share `renderUrl`.
- **No images in the code view.** Either put a short **link** to the picture on its own line, or publish a small HTML
  page with the `<img>` in it and share its live link.
- Links in the text are plain text (copyable, not clickable).
- Everything is **monospace**, so alignment is yours to control - see below.

## Writing text that looks good there

1. **Structure with Unicode rules, not Markdown**: a heavy rule `━━━━` above and below the title, a light rule
   `────` under column headings, short labelled header lines (` 🆔  Build     #1042`).
2. **Columns: fixed-width first, free text last.** Pad IDs, numbers and hashes to a fixed width and put the
   variable text (names, descriptions) in the *last* column. Devanagari, CJK and many emoji are not fixed-width,
   so anything placed *after* them drifts out of line.
3. **No right-hand borders** (` ┃ ... ┃`) - the right edge can't be kept straight. Use rules and left alignment.
4. **Emoji:** use ones that render at full width on their own (📚 🆔 📄 🔐 📷 ✅); some symbols (🖼 ⚠) render
   narrow without a variation selector and break the label alignment.
5. Keep lines to **about 64-72 characters**; no tabs (flatten them to spaces); one final newline.
6. End with a short *how to use* block and `#hashtags` if the paste will be searched or shared.
7. Pick `--lang text` for reports and sheets; use the real language (`python`, `json`, `bash`...) for code or logs.

Ready-made layouts (password sheet, key-value report, table, log excerpt, changelog) are in
[`references/formatting.md`](references/formatting.md).

## Workflow

1. Gather the content; trim secrets and noise. Text: make it fit the layout above. Page: make it one self-contained file.
2. Choose `--lang` (leave it out for HTML/SVG), a `--title`, and `--expires` (default `never`; use `24h`/`7d` for
   anything temporary).
3. Publish with `scripts/paste.py ... --verify` (add `--live` for a page) and read the link from stdout.
4. Reply with the **link**, one line on what is in it and when it expires. For a page, give the live link and mention
   that the code is at `url`.

## Privacy

A paste is **unlisted but public to anyone holding the link**; pages are stored encrypted, but the link is the key.
Never paste tokens, passwords for real systems, private keys or personal data unless the user explicitly asks - and
then prefer a short `--expires`. If the content looks sensitive, ask before publishing. Always tell the user the
link is shareable.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| HTTP 413 | over 10 MiB - split it, or link to large images instead of inlining them |
| HTTP 400 `Paste cannot be empty` | nothing (or only whitespace) was sent |
| `renderUrl` is `null` | not recognised as HTML/SVG - send `"language":"html"` (`--lang html`) |
| live page is blank or a script fails | it needs real storage, cookies or another file - see *Live pages* |
| garbled non-English text on Windows | send UTF-8; `paste.py` already does and reconfigures its output |
| link expired | `expiresIn` was not `never`; publish again (there is no way to extend) |
