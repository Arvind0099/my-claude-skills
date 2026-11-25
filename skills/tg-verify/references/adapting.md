# Fitting it into a project

- [Config](#config)
- [The `app` object](#the-app-object)
- [The `store` object](#the-store-object)
- [Recipes](#recipes): Worker + D1, Worker + Supabase, KV only, Express/Node, Next.js, no https, not JavaScript
- [Client](#client)
- [Wording and language](#wording-and-language)

## Config

```js
createTgVerify({
  siteName: "My Site",        // used in the bot's messages
  secret: env.SESSION_SECRET,      // required: encrypts the token, signs the webhook
  store, app,                      // below
  base: "/api/tg",                 // where the routes live
  botToken: env.TELEGRAM_BOT_TOKEN,// optional; beats the token saved from the admin page
  origin: "",                      // public address, only when the server can't see it (behind a proxy)
  updates: "webhook",              // or "polling"
  joinPath: "/?join=",             // page that mounts mountTgAuth; the one-time key is appended
  minPassword: 6, maxTries: 10, ttl: 15 * 60e3, finishTtl: 30 * 60e3,
  limits: { perIp: 60, total: 1000 },   // requests an hour; loose on purpose, mobile networks share one IP
  clientIp: (request) => ...,      // default: cf-connecting-ip. Don't trust x-forwarded-for unless your own proxy sets it
  text: {},                        // replaces bot sentences, see below
  apiBase, fetch                   // tests only
})
```

Building it per request (`tgFor(env)`) is fine; it does nothing until used.

`joinPath` must be a page that loads the sign-in screen when signed out. If the site signs people in on `/login`, use `/login?join=`. Redirects on the way must keep the query string.

## The `app` object

| Function | Must do |
|---|---|
| `findUser(id)` | → `{ id, login, name, blocked }` or `null`. `blocked` is falsy or a word such as `"banned"`. `id` arrives as text. |
| `createUser({ login, password, name, telegram, phone, request })` | Validate, hash, save, return the user. Throw `UserError("That email already has an account.", 409)` for anything the visitor should read. |
| `checkPassword(login, password)` | → user or `null` (or throw `UserError`). |
| `setPassword(id, password)` | Hash and save. Sign out other sessions if the site can. |
| `deleteUser(id)` | Undo of `createUser`, used when linking the Telegram fails right after it. |
| `signIn(user, request)` | → `{ headers: { "set-cookie": … } }`, or `{ body: { token } }` for sites that keep a token. |
| `currentUser(request)` | → signed-in user or `null`. Return `null` for blocked users. |
| `role(user)` | → `"owner"`, `"staff"` or anything else. |
| `publicUser(user)` | optional; what the browser may see after signing in. |
| `findUsers(ids)` | optional but do it: one query for the admin list, else one query per row. |
| `staffIds()` | optional; whose Telegram gets the "new account" alert. |
| `log(userId, action, detail)` | optional; the site's activity log. Actions: `signup`, `login`, `reset_password`, `link_telegram`, `admin_telegram`. |

Use the functions the project's own login and sign-up already use, so hashing, validation, default permissions, welcome emails and similar stay the same. If that logic is buried inside a route handler, pull it into a function and call it from both.

Errors: `UserError` is shown to the visitor. Everything else is logged and shown as a general message, so database details never leak.

## The `store` object

Use one of the three. Write a new one only for another database, and run `runAll(store)` on it.

| Function | Notes |
|---|---|
| `ready()` | `false` only when the tables are missing; throw on any other error |
| `getConfig(key)`, `setConfig(key, value)` | text; two keys, `settings` and `bot_token` |
| `addLogin(row)` | |
| `loginByToken(hash)`, `loginByFin(hash)`, `loginById(id)` | row or `null` |
| `openLogin(tgId, status)` | newest unexpired row |
| `moveLogin(id, fromStatuses, patch)` | **atomic** conditional update; returns the new row, or `null` when the status didn't match |
| `countLogins({ ip?, since })`, `listLogins(n)`, `deleteLogins(before)` | |
| `account(tgId)`, `accountOf(userId)`, `accountsOf(userIds)` | `tg_id` as a number, `user_id` as text, `is_premium` as a boolean |
| `addAccount(row)` | throw `DuplicateError` on a unique violation |
| `updateAccount(tgId, patch)`, `removeAccount(userId)` | |
| `listAccounts({ search, page, size })` | `{ rows, total }`; search name, username, phone, ID |

Table names can be prefixed: `d1Store(env.DB, { prefix: "site_" })`. Change the schema file to match.

Postgres users table in the same database: give `telegram_accounts.user_id` the same type and `references users(id) on delete cascade`. Otherwise call `tg.forgetUser(id)` where users are deleted.

## Recipes

### Cloudflare Worker + D1
`template/examples/worker-d1.mjs` is complete and tested. For an existing site take `tgFor(env)` and the two marked lines.

### Cloudflare Worker + Supabase
```js
import { supabaseStore } from "./store-supabase.mjs";
store: supabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_KEY })
```
The key is the server's secret key, from `wrangler secret put`. If the project has it hardcoded, reuse the project's own helper, don't print it, and mention that it should become a secret. Remove nothing without asking.

### Only KV, or no database
KV can't do the atomic step: two taps can both win, and a read may be a minute old. Add D1 (`npx wrangler d1 create …`) for these three tables and leave the rest of the site on KV. A Durable Object with SQLite also works through `sqlStore({ dialect: "sqlite", run })`.

### Express, Fastify, plain Node
```js
import { createTgVerify, nodeHandler } from "./tg-verify.mjs";
import { pgStore } from "./store-sql.mjs";
const tg = createTgVerify({ origin: "https://example.com", secret: process.env.SESSION_SECRET, store: pgStore(pool), app, siteName: "Example" });
app.use(nodeHandler(tg));      // answers only its own routes, then calls next()
```
Works before or after `express.json()` and leaves other routes alone. Fastify: give it the raw request and reply. `app` functions get a web `Request`: read the cookie with `request.headers.get("cookie")`. With cookie-session style middleware, resolve the session from that header.

### Next.js (App Router)
`app/api/tg/[...path]/route.js`:
```js
import { tg } from "@/lib/tg";
const run = (request) => tg.handle(request);
export { run as GET, run as POST, run as DELETE };
```
Keep it on the Node or Edge runtime your database client needs. Set `origin` when the host seen by the route isn't the public one.

### No public https (local machine, VPS with an IP)
`updates: "polling"`, `origin: "http://…"`, and call `tg.poll()` once at startup in a process that stays alive. One process only. Not possible on Workers. With `localhost` as the origin the bot sends no website buttons (Telegram refuses them); the page still moves on by itself.

### Not JavaScript (Python, PHP, Go…)
Port from `references/protocol.md`: same tables, routes, states and messages. The client files work unchanged. Test the port through HTTP with `mock-telegram.mjs`.

### TypeScript
Import the `.mjs` files as they are (`allowJs`), or rename to `.ts` with `// @ts-nocheck`. Don't rewrite them for types.

## Client

```js
import { api, mountTgAuth, mountTgLink } from "./tg-client.js";
const view = mountTgAuth(el, {
  loginLabel: "Email", loginType: "email", minPassword: 6,
  signIn: (login, password) => api("/api/login", { login, password }),     // the site's own login call
  signUp: (login, password) => api("/api/signup", { login, password }),    // leave out if there is none
  onSignedIn: (user) => location.assign("/")
});
mountTgLink(el2);                                // account page
import { mountTgAdmin } from "./tg-admin.js";    // admin page
mountTgAdmin(el3);
```

- Each returns `{ stop() }`. Call it when leaving the screen (React: the cleanup of `useEffect`), or a late answer paints over the next page.
- The request survives a reload through `sessionStorage`. On phones the browser is often reloaded when the person comes back from Telegram, so keep this.
- Polling pauses in a hidden tab and runs at once when it's shown again.
- No inline styles or scripts, so a strict CSP works. QR codes are drawn locally; never send the link to an outside QR service.
- `mountTgAuth` reads `?join=` itself and removes it from the address bar.
- In a designed site, prefer rewriting the markup in the project's own components around `telegramPanel(host, { purpose, onVerified, onLinked })`, which does the number, QR, countdown and polling. Use the project's confirm dialog instead of `confirm()`.
- If the project ships files without comments, strip the header comments when copying.

## Wording and language

`text` replaces any sentence in `defaultText()` of `tg-verify.mjs`; keep the HTML tags Telegram allows and keep `esc()` around names. `about` ≤ 512 characters, `short` ≤ 120. Example: `text: { welcome: "👋 <b>…</b>" }`.
