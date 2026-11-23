#!/usr/bin/env python3
"""
Publish text to the N4 Paste pastebin (https://pastebin.arvind.eu.org) and print the shareable link.

Standard library only. Works on Windows, macOS and Linux.

    python paste.py report.txt --title "Weekly report" --expires 7d
    some-command | python paste.py - --title "Build log" --lang bash
    python paste.py sheet.txt --verify --json

Reads UTF-8 from a file, or from stdin when the file is "-" (or omitted and stdin is piped).
Prints the link on stdout; everything else (errors, hints) goes to stderr, so it is safe in pipelines.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("PASTEBIN_URL", "https://pastebin.arvind.eu.org").rstrip("/")
LANGUAGES = (
    "text javascript typescript python json html css scss bash sql rust go java c cpp csharp php ruby swift "
    "kotlin yaml toml xml markdown dockerfile graphql"
).split()
EXPIRY = ("never", "1h", "24h", "7d", "30d")
SOFT_LIMIT = 60 * 1024       # the server answers HTTP 500 somewhere between 64 KB and 128 KB
HARD_LIMIT = 120 * 1024


def fail(msg, code=1):
    print("error: " + msg, file=sys.stderr)
    sys.exit(code)


def read_content(path):
    if path in (None, "-"):
        if path is None and sys.stdin.isatty():
            fail("nothing to publish: give a file, or pipe text in (use '-' for stdin)")
        return sys.stdin.buffer.read().decode("utf-8", "replace")
    try:
        with open(path, "rb") as fh:
            return fh.read().decode("utf-8", "replace")
    except OSError as e:
        fail("cannot read %s: %s" % (path, e.strerror or e))


def post(payload):
    req = urllib.request.Request(
        BASE + "/api/pastes",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "user-agent": "pastebin-arvind-skill/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(body).get("error", body)
        except ValueError:
            detail = body[:200]
        hint = " (the text is probably too large - keep it under ~60 KB or split it)" if e.code == 500 else ""
        fail("the pastebin answered HTTP %d: %s%s" % (e.code, detail, hint))
    except urllib.error.URLError as e:
        fail("could not reach %s: %s" % (BASE, e.reason))


def main():
    ap = argparse.ArgumentParser(description="Publish text to the N4 Paste pastebin and print the link.")
    ap.add_argument("file", nargs="?", help="file to publish, or '-' for stdin")
    ap.add_argument("--title", default="", help="title shown on the page (cut to 120 characters)")
    ap.add_argument("--lang", default="text", help="one of: " + " ".join(LANGUAGES) + " (default: text)")
    ap.add_argument("--expires", default="never", choices=EXPIRY, help="how long the link lives (default: never)")
    ap.add_argument("--raw", action="store_true", help="print the raw-text link instead of the page link")
    ap.add_argument("--json", action="store_true", help="print the whole API answer as JSON")
    ap.add_argument("--verify", action="store_true", help="fetch the raw text back and check it matches")
    args = ap.parse_args()

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    content = read_content(args.file)
    if not content.strip():
        fail("the text is empty")
    size = len(content.encode("utf-8"))
    if size > HARD_LIMIT:
        fail("%d KB is too big for the pastebin (it fails above ~64-128 KB) - split it into parts" % (size // 1024))
    if size > SOFT_LIMIT:
        print("warning: %d KB is close to the pastebin's limit and may be refused" % (size // 1024), file=sys.stderr)
    if args.lang not in LANGUAGES:
        print("note: '%s' is not in the pastebin's language list; it will only be shown as a label" % args.lang, file=sys.stderr)

    result = post({"title": args.title[:120], "language": args.lang, "content": content, "expiresIn": args.expires})
    if not result.get("url"):
        fail("unexpected answer from the pastebin: %r" % (result,))

    if args.verify:
        try:
            with urllib.request.urlopen(urllib.request.Request(result["rawUrl"], headers={"user-agent": "pastebin-arvind-skill/1.0"}), timeout=30) as r:
                back = r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - any failure here is just "could not verify"
            fail("published (%s) but could not read it back: %s" % (result["url"], e))
        if back.strip() != content.strip():
            fail("published (%s) but the stored text differs from what was sent" % result["url"])
        print("verified: the stored text matches", file=sys.stderr)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["rawUrl"] if args.raw else result["url"])
        if result.get("expiresAt"):
            print("expires: " + result["expiresAt"], file=sys.stderr)


if __name__ == "__main__":
    main()
