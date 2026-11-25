# Layouts for N4 Paste

The N4 Paste code view shows text in a monospace block with line numbers - no Markdown, no images, HTML as source.
These templates are built for that. (For a formatted page, publish HTML instead and share its live link - see *Live
pages* in `SKILL.md`.) Rules of thumb: fixed-width columns first, free text last (Devanagari/CJK/emoji aren't fixed width),
no right-hand borders, no tabs, one final newline, about 64-72 columns.

Use `--lang text` for all of them.

---

## 1. Sheet with a table (IDs, keys, hashes)

A ruled header block, labelled lines, then a fixed-width table - the layout the SSGC Library admin uses for its sheets:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🚀  Launch board - Project Falcon (demo)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 🆔  Build     #1042
 🌿  Branch    main
 ✅  Checks    128 passed · 0 failed
 🔗  Link      https://example.org/launch/1042

 #    SERVICE    RUN ID                            NOTE
 ──   ────────   ────────────────────────────────  ────────────────────────
 01   api        980f90332dd2542c68a4a37b2b2e274d  Rolled out to 3 regions
 02   web        1bd344c89bdcd3b89fa8ca91e739b675  Cache warmed
 03   worker     df207562dcc6b18e4ce632afcde8b72b  Waiting for the queue to drain
 ──   ────────   ────────────────────────────────  ────────────────────────

 HOW TO READ
   1. Find your service in the SERVICE column.
   2. The RUN ID on the same row is what you quote in a ticket.

 #launch  #demo  #build_1042
```

Notes: zero-pad the row number to the width of the largest; pad ids to the longest id; keep the *note* column last.

## 2. Key-value report

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 📊  Deploy report - ssgc-library
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Version     6186cc63
 When        2026-11-23 07:10 UTC
 Result      ✅ passed (418 checks)
 Duration    41 s

 NOTES
   • merge limit raised to 30 MB
   • cover images open in a lightbox
```

## 3. Plain table

```text
 NAME          SIZE      PAGES   STATUS
 ────────────  ────────  ──────  ────────
 chapter-01    3.4 MB       134  cached
 chapter-02    1.1 MB        48  cached
 chapter-03    7.9 MB       323  missing
```

Right-align numbers with `str.rjust`; left-align text. Put the longest free-text column last.

## 4. Log excerpt

```text
 📜  nginx error log - last 40 lines (2026-11-23)
 ─────────────────────────────────────────────────
 07:01:12  [warn]   upstream timed out (110) ...
 07:01:12  [error]  connect() failed (111) ...
```

Publish with `--lang bash` (or `text`). Trim to the relevant lines and remove tokens, cookies and IP addresses first.

## 5. Changelog

```text
 ## 1.4.0 - 2026-11-23
   + added  the Passwords tab
   ~ changed  merge limit 20 MB -> 30 MB
   - fixed  Telegram links opened twice
```

---

### Avoid

- Markdown tables (`| a | b |`), `**bold**`, `# headings` - they show up as raw symbols.
- ` ┃ ... ┃ ` right borders - they never line up with non-Latin text.
- Emoji that render narrow (🖼 ⚠ ✔ without a variation selector) inside aligned label blocks.
- Anything over 10 MiB - the pastebin answers HTTP 413.
