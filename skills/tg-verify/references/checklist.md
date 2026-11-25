# Before calling it done

## Pitfalls met before

- **A second sign-up route left open.** Search for every place that inserts a user.
- **Auth middleware in front of the webhook.** Telegram has no session: exempt `/api/tg/webhook` (and `/options`, `/start`, `/status`, `/finish`) from login checks, CSRF tokens, bot protection and redirects. A live `POST` without the secret must answer 404 (not connected) or 401 (connected), never 302 or 403.
- **The site's redirect drops `?join=`.** Open `/?join=aaaa` signed out and check that the sign-in screen still sees it.
- **Connected from the wrong address.** The webhook uses the address the admin page was opened on. Use the real domain, not `workers.dev` or localhost.
- **Same bot as another project.** A bot has one webhook. Connect warns before moving it; a bot run by a polling script can't be detected and will break.
- **`secret` changed later.** The stored token can't be read any more; the admin page says so. Paste it again.
- **`user_id` type.** Text on one side and number on the other: the core compares as text, but a foreign key needs the same type.
- **`bigint` from Postgres drivers arrives as a string.** The bundled store converts it; a new store must too.
- **Local development that talks to the live database.** Check before testing. Override the database for the mock run.
- **Late answers painting over another page.** Call `stop()` when leaving.
- **Cards and tables on phones.** Grid and flex children need `min-width: 0`.
- **Toasts under a modal dialog.** A toast inside the top layer (popover) stays visible.
- **Backslashes in shell heredocs.** When adding bot text through a script, `\n` may turn into a real line break inside a string. Use the editor tools and run `node --check`.
- **Dev server with a watch build.** Don't run the build by hand at the same time.

## Tests to run

With the mock bot (`TEST_TOKEN`), on a local or test database:

- [ ] `node template/test/e2e.mjs`, and `runAll(store)` on the project's store
- [ ] Not connected: the old sign-up works, `/start` answers 409, admin says Not connected
- [ ] Tables missing: the site still works, admin says Database not ready
- [ ] Connect; a wrong token; a bot that works elsewhere (cancel, then move)
- [ ] Plain sign-up is refused once connected
- [ ] Sign up with the number shared and with Skip; own login and password work afterwards
- [ ] Telegram sign-in; wrong number; *Not me*; another person's tap
- [ ] Forgot password; link from the account page; link an existing account while signing up
- [ ] Blocked user refused; person without a role can't open the admin routes; staff can't change the bot
- [ ] Reload in the middle; open the bot's finish button in another browser; use it twice
- [ ] 360px and desktop, light and dark, no sideways scroll, no console errors
- [ ] No token, database key or test data in the files that get deployed

## Live checks after deploying

```
GET  /api/tg/options          200 {"mode":"plain","bot":null}   before connecting
POST /api/tg/start            409                               before connecting
POST /api/tg/webhook          404                               before connecting, 401 after
GET  /api/tg/admin            401 signed out
the site's own pages          as before
```
Don't sign in to the live site yourself; the owner does that.

## Owner's steps

1. Run the schema file (Supabase: SQL editor; D1: the `wrangler d1 execute` command).
2. @BotFather: `/newbot`, choose a name and a username ending in `bot`, copy the token. Don't send it in chat.
3. Open the admin page on the live https domain, paste the token, press **Connect**. It should say **Working**.
4. Optional: rules on the same page. For a must-join channel, first make the bot an admin of it. For staff alerts, staff link their own Telegram on the account page.
5. Create a test account from a phone in a private window.

After they connect, check: `/options` shows the bot and the mode, `/webhook` answers 401, and (with their OK) that the test sign-up shows up in the admin list.

## Optional: keep a free Supabase project awake

It pauses after about 7 days without database activity. Add `GET /api/ping` that **writes and reads** one config row (not only a health check), answers 200 or 503, and is cached for about 60 seconds at the edge so nobody can hammer the database with it. The owner adds it on cron-job.org: GET, every 12 hours. Do the same write in the Worker's daily cron if there is one.
