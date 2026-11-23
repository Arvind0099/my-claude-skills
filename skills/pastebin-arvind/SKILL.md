---
name: pastebin-arvind
description: Publish text, code, logs, reports or tables to the owner's N4 Paste pastebin (pastebin.arvind.eu.org) and return a shareable link. Use when the user says "paste this", "put it on my pastebin", "make a shareable link", "share this as a link", or when a result is too long or too structured for chat (a log excerpt, a password/ID sheet, a table, a report, a diff). Covers the API, the languages and expiry options, the size limit, what the page can and cannot render (monospace text only - no Markdown, no images), and how to lay text out so it looks good there.
---

# pastebin-arvind

Publishes text to **N4 Paste** - the owner's pastebin at <https://pastebin.arvind.eu.org> - and gives back a link
anyone can open. Built and maintained with credit to [@N4pst3rX](https://t.me/N4pst3rX).

## When to use it

- The user asks for a paste, a pastebin link, or "something I can share".
- Output is long, tabular or log-like and would be clumsy in chat.
- A system needs a **link to text** (a Telegram caption over its length limit, a bug report, a job report).

Do **not** use it for secrets the user hasn't explicitly said may be shared (see *Privacy*).

## Quick start

```bash
python scripts/paste.py report.txt --title "Weekly report" --expires 7d       # a file
some-command | python scripts/paste.py - --title "Build log" --lang bash       # stdin
python scripts/paste.py sheet.txt --verify                                     # read it back and compare
```

The script prints the page link on stdout (hints and errors go to stderr). Options: `--title`, `--lang`,
`--expires` (`never` `1h` `24h` `7d` `30d`), `--raw` (raw-text link), `--json` (full API answer), `--verify`.
Set `PASTEBIN_URL` to use a different instance. Standard library only - nothing to install.

Without Python, call the API directly:

```bash
curl -s -X POST https://pastebin.arvind.eu.org/api/pastes \
  -H "content-type: application/json" \
  --data '{"title":"My paste","language":"text","content":"hello","expiresIn":"never"}'
```

## The API

`POST /api/pastes` with JSON `{ title?, language?, content, expiresIn? }`

| field | notes |
|---|---|
| `content` | required, UTF-8 text. Empty -> HTTP 400 `Paste cannot be empty`. |
| `title` | optional; shown as the page heading. Keep it under 120 characters. |
| `language` | optional label (default `text`): `text javascript typescript python json html css scss bash sql rust go java c cpp csharp php ruby swift kotlin yaml toml xml markdown dockerfile graphql`. An unknown value is accepted and only shown as a label. |
| `expiresIn` | `never` (default), `1h`, `24h`, `7d`, `30d`. Anything else silently becomes `never`. |

Answer (HTTP 201): `{ "id", "url", "rawUrl", "expiresAt" }` - `url` is the page, `rawUrl` is `/r/<id>` (plain text),
`expiresAt` is an ISO time or `null`. A page also offers Copy, Download, Wrap, **Fork** (`/?fork=<id>`) and Raw.

**Limits found by testing:** about 64 KB works, 128 KB and up fails with HTTP 500 - keep a paste under ~60 KB and
split anything larger. There is **no delete endpoint** (`DELETE` answers 405), so choose an expiry for anything
you may want gone.

## What the page can render - and what it can't

The page is a **code viewer**: your text in a monospace block with line numbers. That decides how to write for it.

- **No Markdown, no HTML** - they are shown as source, not rendered. Don't rely on `#`, `**bold**`, tables or links.
- **No images.** The page's security policy only allows `data:` images and nothing renders them, so a picture
  cannot be shown. Put a short **link** to the picture on its own line instead (chat apps turn the first link in a
  message into a preview), and say so rather than promising an embedded image.
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

1. Gather the content; trim secrets and noise; make it fit the layout above.
2. Choose `--lang`, a `--title`, and `--expires` (default `never`; use `24h`/`7d` for anything temporary).
3. Publish with `scripts/paste.py ... --verify` and read the link from stdout.
4. Reply with the **link**, one line on what is in it and when it expires. If an image was wanted, give the image
   link separately and say the pastebin can't display pictures.

## Privacy

A paste is **unlisted but public to anyone holding the link**; pages are stored encrypted, but the link is the key.
Never paste tokens, passwords for real systems, private keys or personal data unless the user explicitly asks - and
then prefer a short `--expires`. If the content looks sensitive, ask before publishing. Always tell the user the
link is shareable.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| HTTP 500 | text too large - keep under ~60 KB, split it |
| HTTP 400 `Paste cannot be empty` | nothing (or only whitespace) was sent |
| garbled non-English text on Windows | send UTF-8; `paste.py` already does and reconfigures its output |
| link expired | `expiresIn` was not `never`; publish again (there is no way to extend) |
| wanted a rendered page or an image | not supported by this pastebin - use a link to the image, or host a page elsewhere |
