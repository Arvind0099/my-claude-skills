<div align="center">

# 🧰 my-claude-skills

**A growing toolbox of small, sharp skills for Claude Code.**
Drop a folder in, and your assistant learns a new trick.

[![Skills](https://img.shields.io/badge/skills-1-8b5cf6?style=for-the-badge)](#-the-skills)
[![Python](https://img.shields.io/badge/scripts-Python%20stdlib%20only-22d3ee?style=for-the-badge&logo=python&logoColor=white)](#)
[![Platform](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-1c2230?style=for-the-badge)](#)
[![Crafted by](https://img.shields.io/badge/crafted%20with%20%E2%9A%A1%20by-%40N4pst3rX-2AABEE?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/N4pst3rX)

[The skills](#-the-skills) · [Install](#-install) · [Add your own](#-adding-a-skill) · [Credits](#-credits)

</div>

---

## ✨ What is this?

An **umbrella repository** for personal skills. Each skill is a self-contained folder under [`skills/`](skills/) with a
`SKILL.md` (what it is, when to use it, how it works) and, where useful, helper scripts and reference notes.
Skills are plain files - no build step, no dependencies beyond what a script says it needs.

## 📦 The skills

| Skill | What it does | Needs |
|---|---|---|
| [**`pastebin-arvind`**](skills/pastebin-arvind/) | Publishes text, logs, tables and reports to the **N4 Paste** pastebin and hands back a shareable link - with a layout guide that makes plain monospace text look good. | Python 3 (stdlib only) |

> More are on the way - this table grows with the repo.

### 🔗 `pastebin-arvind` at a glance

```text
python scripts/paste.py sheet.txt --title "Launch board" --expires 7d --verify
https://pastebin.arvind.eu.org/AbC123xy
```

- **One command, one link** - file or stdin in, shareable URL out; `--verify` reads it back to prove it arrived intact.
- **Knows the pastebin** - API fields, languages, expiry choices (`never` `1h` `24h` `7d` `30d`) and the size ceiling
  (stay under ~60 KB), all found by testing the live service.
- **Honest about its limits** - the page is a monospace code viewer: no Markdown, no HTML, **no images**. The skill
  says so, and shows what to do instead (a short link to the picture, chat apps preview it).
- **Layouts that look good** - heavy rules, fixed-width columns with the free text *last* (so Devanagari and emoji
  can't push things out of line), ready-made templates in [`references/formatting.md`](skills/pastebin-arvind/references/formatting.md):

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🚀  Launch board - Project Falcon (demo)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 🆔  Build     #1042
 🌿  Branch    main
 ✅  Checks    128 passed · 0 failed

 #    SERVICE    RUN ID                            NOTE
 ──   ────────   ────────────────────────────────  ────────────────────────
 01   api        cadb0edf1dd0544201735055f22d3b61  Rolled out to 3 regions
 02   web        0e67981d660592121576e1f0e29c6df6  Cache warmed
 03   worker     ee3b23423130a653930511278c3d6d85  Waiting for the queue to drain
 ──   ────────   ────────────────────────────────  ────────────────────────
```

## 🚀 Install

Skills load from a `skills/` folder in your Claude Code configuration. Pick one:

**Everything at once**

```powershell
# Windows (PowerShell)
git clone https://github.com/Arvind0099/my-claude-skills.git
Copy-Item -Recurse my-claude-skills\skills\* "$HOME\.claude\skills\"
```

```bash
# macOS / Linux
git clone https://github.com/Arvind0099/my-claude-skills.git
cp -r my-claude-skills/skills/* ~/.claude/skills/
```

**Just one skill** - copy its folder (for example `skills/pastebin-arvind`) into `~/.claude/skills/`.

**Per project** - copy it into the project's `.claude/skills/` instead, so only that project sees it.

Start a new session and the skill is available; mention what you want ("paste this as a shareable link") and it kicks in.

**Stay up to date** - `git pull`, then copy again (or symlink the folders once, and every pull updates them).

## 🛠 Adding a skill

1. Create `skills/<skill-name>/SKILL.md` (lowercase, hyphens).
2. Start it with front matter - the `description` is what decides *when* the skill is used, so make it specific:

   ```markdown
   ---
   name: my-skill
   description: One or two sentences - what it does AND the situations that should trigger it.
   ---

   # my-skill
   ...instructions, examples, limits...
   ```

3. Keep helpers next to it: `scripts/` for code, `references/` for longer notes loaded only when needed.
4. Prefer the standard library, say what each script needs, and **test it against the real thing** before committing.
5. Add a row to the table above.

### 🗂 Layout

```text
my-claude-skills/
├── README.md
└── skills/
    └── pastebin-arvind/
        ├── SKILL.md                 ← what it is, when to use it, the API, the rules
        ├── scripts/
        │   └── paste.py             ← publish text, print the link
        └── references/
            └── formatting.md        ← layouts that look good in a monospace viewer
```

## 💜 Credits

Crafted with ⚡ by **[@N4pst3rX](https://t.me/N4pst3rX)** - the N4 Paste pastebin these skills are built around is crafted by them
([Telegram](https://t.me/N4pst3rX) · [X](https://x.com/N4pst3rX)).
Collected and maintained by [Arvind0099](https://github.com/Arvind0099).

<div align="center">

<sub>Made to be copied, remixed and improved. ⭐ the repo if it saves you a minute.</sub>

</div>
