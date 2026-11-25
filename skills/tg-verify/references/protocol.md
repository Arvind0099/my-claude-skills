# Routes, states and reasons

- [Routes](#routes)
- [A request's life](#a-requests-life)
- [Keys](#keys)
- [Bot messages](#bot-messages)
- [Finish](#finish)
- [Admin](#admin)
- [Attacks this design stops](#attacks-this-design-stops)

## Routes

All under `base` (`/api/tg`). JSON in and out; errors are `{ error }` with a status. Every non-GET except the webhook is refused when its `Origin` is another site.

| Route | Who | Answer |
|---|---|---|
| `GET /options` | anyone | `{ mode: "plain" \| "telegram" \| "both" \| "closed", bot }` |
| `POST /start` `{ purpose }` | anyone; `link` needs a session | `{ token, poll, code, bot, url, ttl }` |
| `POST /status` `{ token, poll }` | the browser that started it | `{ st, … }` |
| `POST /finish` `{ token, poll }` or `{ fin }` + fields | same, or the bot's button | signs in; `{ user }` |
| `POST /webhook` | Telegram | `ok` |
| `GET /me` | signed in | `{ bot, telegram }` |
| `GET /admin`, `/admin/people`, `/admin/requests` | staff, owner | |
| `POST /admin` `{ action: connect \| disconnect \| settings }`, `DELETE /admin/people/:userId` | owner | |

`purpose`: `auth` (sign up or in), `reset`, `link`.

## A request's life

```
new ──Start──▶ asked ──right number──▶ [join] ──▶ [phone] ──▶ verified ──finish──▶ done
        │         │
        │         └─ wrong number / Not me ─▶ denied (number, refused)
        └─ denied (blocked, taken, unknown, closed)          finish fails 10 times ─▶ denied (tries)
```

- `join` only when a channel is set, `phone` only when the number isn't `off`; both only for people who have no account yet.
- `link` goes `verified` → `done` inside one update, or `denied` (link) when saving fails. While it is `verified`, `/status` still says `asked` and `/finish` refuses it.
- Runs out 15 minutes after the start; 30 minutes after being verified.
- Every arrow is `update … where id = ? and status in (…)`; no row back means somebody else already moved it, so stop.
- `/status` answers `new, asked, join, phone, verified, done, denied (why), gone`. The person's name is included only from `join` on, so starting a request and sending somebody the link reveals nothing about them.

## Keys

| Key | Length | Lives in | Stored as |
|---|---|---|---|
| `token` | 20 of `a-z0-9` | the t.me link (`start=j_<token>`, fits Telegram's 64) | SHA-256 |
| `poll` | 32 | only the browser | SHA-256 |
| `fin` | 32 | only the bot's last message (`?join=<fin>`) | SHA-256 |
| code | 10 to 99, one of six shown | website, and the buttons | plain |

Callback data: `n:<id>:<number>`, `x:<id>` (not me), `j:<id>` (joined); all under 64 bytes.

## Bot messages

- Only private chats, never other bots. Anything else is ignored.
- `/start j_<token>`: check, then send the six numbers in two rows and *Not me*. The text names what is being asked (create, sign in as `ab***@x`, new password, link) and the device and place it was asked from.
- A second person opening the same link gets "already used".
- A button press counts only from the Telegram ID that opened the link.
- The contact must be the sender's own (`contact.user_id === from.id`); number kept as `+digits`. The reply keyboard is removed afterwards.
- The last message carries the one-time website button, for when the browser didn't move on (another device, in-app browser).
- `/start` alone: welcome, or "linked to ab***@x". `/id`: the Telegram ID.
- All names are HTML-escaped.
- The update handler always answers 200, also after an error, or Telegram repeats the update for hours. A missing or wrong secret header gets 401, a bot that isn't connected 404.

## Finish

1. Find the row (token + poll, or fin). It must be `verified`, not `link`, not expired. Otherwise 410.
2. Blocked account: 403.
3. `check: true` only reports what is needed: `login`, `reset` or `details`.
4. Take the row (`verified` → `done`). Whoever takes it continues; everyone else gets 410.
5. `login`: sign in. `reset`: check the length, set the password, sign in. `details`: create the account **or**, with `existing: true`, check the password of an account that has no Telegram yet; then save the Telegram row.
6. If step 5 fails, delete a just-created account and give the row back (`done` → `verified`, `tries` + 1), so a typo doesn't burn the verification. At 10 tries it is denied, which also limits password guessing through `existing`.

## Admin

- **Connect**: check the token's shape, `getMe`, then `getWebhookInfo`. If the bot already works for another address, answer 409 `{ elsewhere, username }` and change nothing; `move: true` confirms and drops what was waiting. Then save the token (AES-GCM, key from `secret`), `setWebhook` with `secret_token` = HMAC(`secret`, token), `setMyCommands`, and a description if the bot has none.
- **Settings**: the channel is checked (bot must be an admin there) before it is saved.
- **State**: from `getWebhookInfo`, shown as Working, Pointed elsewhere, Messages are stuck, Telegram refused, Token can't be read (secret changed), Not connected, Database not ready.
- The token is never sent back. Lists never include hashes, codes or options.

## Attacks this design stops

| Attack | Stopped by |
|---|---|
| Attacker sends a victim their own login link | number matching, device and place in the message, *Not me* |
| Somebody sees the t.me link and polls it | poll key |
| Database leak | only hashes; token encrypted with a key outside the database |
| Forged webhook calls | secret header, constant-time compare |
| Replay, double tap, two tabs | guarded moves, one-time keys |
| Walking around the verification | `plainSignupAllowed()` on every other sign-up route |
| Many accounts from one Telegram | unique `tg_id` and `user_id` |
| Banned person returns | `blocked` checked at start and at finish |
| Guessing a password through `existing` | 10 tries per verification |
| Flooding | per-IP and total limits per hour; rows deleted after 30 days |
| Another site posting on behalf of an admin | Origin check on top of the session cookie |
