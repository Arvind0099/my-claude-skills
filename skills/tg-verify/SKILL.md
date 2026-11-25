---
name: tg-verify
description: Adds the owner's Telegram-bot verification and login system to any website or app. People verify in a Telegram bot (number matching), then create their own email/username and password; also "Continue with Telegram" sign-in, forgot password through Telegram, linking an existing account, and an admin page to connect the bot, set rules (mobile number, must-join channel, staff alerts) and see everyone who verified. Ships tested server code, schemas for Supabase/Postgres and D1/SQLite, client UI, a mock bot and tests. Use whenever the user types /tg-verify or asks for Telegram verification, Telegram login or sign-up, "TG bot se verify/create account", "telegram verification system add karo", "same Telegram login as my other project", or wants to know who signs up by their Telegram name, username or number.
---

# tg-verify

Add the owner's Telegram verification system to the project in the current folder. The owner has described it before and does not want to describe it again: `/tg-verify` alone means "add the same system here". Work from this file, make sensible choices, and ask only when a wrong guess would be costly (see *When to ask*).

Reply in the language the user wrote in (often Hinglish). Keep text on the site and in the bot in simple English, unless the site itself is in another language.

## What it does

1. On the site, **Create an account** shows a two-digit number, a button to the bot and (on wide screens) a QR code.
2. In the bot the person presses **Start** and taps the same number out of six. A wrong number or **Not me** stops the request.
3. If set: they join a channel, and share their mobile number (or skip).
4. The site notices by itself and asks for name, login and password. From then on they sign in with those, or with **Continue with Telegram**.
5. Also: forgot password through Telegram; linking Telegram from the account page; linking an existing account instead of creating a second one.
6. Admin page: connect the bot by pasting its token, choose who may sign up (`telegram` only, `both`, `closed`), mobile `ask`/`required`/`off`, must-join channel, staff alerts; list of verified people with search, CSV and unlink; latest requests with their result.

Kept for each person: Telegram name, username, ID, language, premium, mobile if shared and when, verified time, last seen, device, IP, city, country. The sign-up screen says so; keep that sentence, because people are handing over personal data.

Until the bot is connected nothing changes for visitors: the normal sign-up stays open. This lets you deploy first and the owner connect later.

## Files

```
template/server/tg-verify.mjs      the whole system; needs a `store` and an `app`
template/server/store-sql.mjs      D1, SQLite, Postgres       store-supabase.mjs   Supabase REST      store-memory.mjs   tests
template/schema/                   postgres.sql (also Supabase), sqlite.sql (also D1)
template/client/                   tg-client.js (sign-in screens, account card), tg-admin.js, qr.js, tg.css
template/examples/worker-d1.mjs    a complete working Worker with accounts
template/test/                     e2e.mjs, mock-telegram.mjs, demo.mjs (site + pretend phone)
references/adapting.md             `app` and `store` contracts, a recipe per stack       read before writing code
references/protocol.md             routes, states, security reasons                      read to port it or to debug
references/checklist.md            pitfalls, test list, live checks, owner's steps       read before deploying
```

Copy files, don't retype them. `tg-verify.mjs` carries many small security decisions that are easy to lose when rewritten; adapt through `app`, `store` and the config instead of editing it. Only port it (from `references/protocol.md`) when the backend isn't JavaScript.

Paths here are relative to this skill's folder. To see it working first: `node <skill folder>/template/test/demo.mjs`, then open http://127.0.0.1:8795.

## Steps

1. **Look at the project.** Find: runtime (Worker, Node, Next.js, other), database, users table, how passwords are checked, how the session cookie or token is made, roles, existing sign-up and login routes, login screen, account page, admin page, deploy command, project rules (CLAUDE.md, memory). Check whether part of this already exists.
2. **Read `references/adapting.md`** and choose the store and the recipe.
3. **Schema.** Copy the right file into the project under its own naming. For Supabase the owner runs it in the SQL editor. For D1, `wrangler d1 execute` (ask before running it on the remote database unless the user already said to go ahead).
4. **Server.** Copy `server/` files, write the `app` object from the project's own functions, call `tg.handle(request, ctx)` before the other routes, and call `tg.cleanup()` from a cron if there is one.
5. **Close the way around.** Every other route that creates accounts must check `await tg.plainSignupAllowed()` and refuse when it is false. Miss one and the verification means nothing. Look for social logins, invite links and old endpoints too.
6. **Client.** Put `mountTgAuth`, `mountTgLink` and `mountTgAdmin` into the project's own screens. Match the site's existing design: reuse its inputs, buttons, dialogs and toasts, and either set the `--tgv-*` variables or rewrite the markup. A default-looking box in a designed site reads as unfinished. Keep the calls, the states and the order of screens.
7. **Admin.** Add the page to the admin menu. Show a person's Telegram details wherever the admin already opens a user (`tg.telegramOf(userId)`), and call `tg.forgetUser(userId)` when a user is deleted if the database doesn't cascade.
8. **Test** as in *Testing*, then deploy if the user normally expects that, then check the live site.
9. **Report** as in *Report*.

## Defaults to use without asking

| Choice | Default |
|---|---|
| Who may sign up, once connected | `telegram` only |
| Mobile number | `ask` (may skip) |
| Channel, staff alerts | off |
| Login field | whatever the site uses today; email if it has none |
| Minimum password | the site's own rule, else 6 |
| Routes | `/api/tg/*` (follow the project's prefix if it has one) |
| Bot token | pasted by the owner in the admin page, stored encrypted |
| Who may change the bot | owner role only; staff may look |
| Storage | the database the project already has; D1 if it only has KV |

Anything the user put after `/tg-verify` overrides this table, for example "mobile required, must join @channel".

## When to ask

- The project has no user accounts at all: ask whether they want accounts (then use `examples/worker-d1.mjs`) or only a gate in front of some pages.
- More than one sign-up system or database, and it isn't clear which one is real.
- Existing users would lose access because of the change.
- Anything that writes to or deletes from a live database.

## Security rules, and why

- **Never handle the real bot token.** Not in code, config files, shell commands, test data or replies. Whoever has it controls the bot. The owner pastes it into the admin page (or runs `npx wrangler secret put TELEGRAM_BOT_TOKEN` themselves). If they paste it in chat, don't repeat or use it: point them to the admin page and suggest `/revoke` in @BotFather for a fresh one. Test with the mock token only.
- **`secret` must be a real secret** (existing session secret or a new one). It encrypts the token and proves that webhook calls come from Telegram.
- **Number matching stays.** A plain "press Start to log in" link lets an attacker send their own link to a victim and get in as them. The number, the device and place in the message, and *Not me* are what stop that.
- **Every step is a guarded move** (`update … where status in (…)`), so double taps, retries and races can't finish a request twice. A store must do this atomically, which rules out KV.
- **Only hashes** of the request token, poll key and finish key are stored. All three are one-time and short-lived.
- **The browser needs the poll key as well as the token**, because the token is visible inside the Telegram link.
- **The database key and the token never reach the browser.** On Supabase keep row level security on with no policies.
- **Blocked users stay blocked**: `findUser` must report `blocked`, or a banned person walks back in through Telegram.
- **One Telegram, one account.** The unique columns in the schema enforce it.

## Testing

```bash
node <skill folder>/template/test/e2e.mjs                  # must pass before and after any change to the server file
node <skill folder>/template/test/mock-telegram.mjs 8799   # then run the project locally with apiBase = http://127.0.0.1:8799
```

1. Run `runAll(store)` from `e2e.mjs` against the project's store on an **empty local or test database**. It creates and deletes rows, so never point it at a live one.
2. Run the project locally with the mock: connect with `TEST_TOKEN`, then sign up, sign in, wrong number, *Not me*, reset, link, blocked user, and the closed plain sign-up. Drive the pretend person with `/__open`, `/__tap`, `/__share` (documented at the top of `mock-telegram.mjs`).
3. If local development uses the live database (common with hardcoded Supabase settings), override it for the test, or test only what doesn't write.
4. Look at every new screen at 360px and on desktop, in light and dark. Nothing may scroll sideways (`innerWidth` must stay 360).
5. Reload in the middle of a request: it must continue, not start over.

A real bot can only be tested by the owner after connecting. Say so plainly instead of calling it tested.

## Report

Short, in the user's language:

- What works now, and that visitors see no change until the bot is connected.
- **What the owner does, numbered:** run the schema (name the file), create a bot in @BotFather with `/newbot`, open the admin page on the live https site and paste the token, press Connect, then create a test account from a phone.
- That connecting closes the plain sign-up at once, and where to change it.
- What was tested and how, and what was not (the real bot).
- If the database is a free Supabase project: it pauses after about 7 days without activity; offer a small `/api/ping` that really writes and reads a row, for cron-job.org.
