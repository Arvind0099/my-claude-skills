// Telegram verification, sign-up, sign-in, password reset and account linking.
// Web standards only (Request, Response, fetch, WebCrypto): Cloudflare Workers, Node 20+, Deno, Bun.
// Everything project-specific comes in through `store` (database) and `app` (accounts). See references/adapting.md.

const enc = new TextEncoder();
const dec = new TextDecoder();
const KEY20 = /^[a-z0-9]{20}$/, KEY32 = /^[a-z0-9]{32}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const now = () => new Date().toISOString();
const later = (ms) => new Date(Date.now() + ms).toISOString();
const expired = (row) => new Date(row.expires_at).getTime() < Date.now();
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomInt = (min, max) => min + (crypto.getRandomValues(new Uint32Array(1))[0] % (max - min + 1));
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const fullName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
const person = (f) => ({ id: f.id, first_name: clip(f.first_name, 120) || null, last_name: clip(f.last_name, 120) || null, username: clip(f.username, 64) || null, language_code: clip(f.language_code, 12) || null, is_premium: !!f.is_premium });
const profile = ({ first_name, last_name, username, language_code, is_premium }) => ({ first_name, last_name, username, language_code, is_premium: !!is_premium });

function same(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function randomKey(n) {
  let out = "";
  while (out.length < n) for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) if (b < 252 && out.length < n) out += ALPHABET[b % 36];
  return out;
}
function json(data, status = 200, headers = {}) {
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: h });
}
const fail = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

export function maskLogin(login) {
  const [a, b] = String(login || "").split("@");
  const hidden = a.slice(0, Math.min(2, a.length)) + "***";
  return b ? hidden + "@" + b : a ? hidden : "";
}

// Thrown by `app` functions; the message is shown to the visitor as it is.
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
// Thrown by `store.addAccount` when that Telegram or that user already has a row.
export class DuplicateError extends Error {}
export class TelegramError extends Error {
  constructor(code, description) {
    super(description || "Telegram didn't answer.");
    this.code = code;
  }
}

// Every sentence the bot says. Pass `text` in the config to replace any of them (wording or language).
export const defaultText = (site) => ({
  about: [`This bot verifies you for ${site}.`, "If the website sent you here, tap START and then the number you see on the website.", "The bot never asks for your password."].join("\n\n").slice(0, 512),
  short: `Verifies new accounts and sign-ins for ${site}.`.slice(0, 120),
  open: `Open ${site}`.slice(0, 60),
  welcome: `👋 <b>Welcome to ${esc(site)}.</b>\nTo create an account, open the website and choose <b>Create an account</b>. It brings you back here.`,
  linked: (name, login) => `👋 <b>Hello ${esc(name)}.</b>\nThis Telegram is linked to <b>${esc(login)}</b>. Use <b>Continue with Telegram</b> on the website to sign in without a password.`,
  id: (id) => `Your Telegram ID: <code>${id}</code>`,
  expired: "⌛ <b>This request has run out.</b> Go back to the website and start again.",
  used: "🔁 This request was already used. Start again on the website.",
  blocked: "🚫 This account is blocked. Contact the site's owner if you think that's a mistake.",
  taken: "⚠️ This Telegram already belongs to another account. Use that one, or ask the owner to unlink it.",
  unknown: "No account is linked to this Telegram, so there is no password to reset.",
  closed: "🚫 New accounts are closed at the moment.",
  ask: (name, what, where) => `🔐 <b>Hello ${esc(name)}.</b>\nTo ${what}, tap the number you see on the website.${where ? `\n\n<i>Asked from ${esc(where)}</i>` : ""}\n\nDidn't start this yourself? Tap <b>Not me</b>, even if somebody told you a number.`,
  toLink: (login) => `link this Telegram to <b>${esc(login)}</b>`,
  toReset: (login) => `set a new password for <b>${esc(login)}</b>`,
  toSignIn: (login) => `sign in as <b>${esc(login)}</b>`,
  toCreate: "create your account",
  notMe: "Not me",
  refused: "🛑 <b>Stopped.</b> Nothing happened. If somebody sent you that link, ignore it.",
  wrong: "🛑 <b>That isn't the number on the website,</b> so nothing happened. Start again there if it was you.",
  join: (title, again) => `📢 <b>${again ? "Not there yet. " : ""}Join ${esc(title)} first</b>, then tap <b>I joined</b>.`,
  openChannel: (title) => `Open ${title}`.slice(0, 60),
  joined: "I joined",
  matched: "✅ <b>Number matched.</b>",
  phone: (must) => `📱 <b>Share your mobile number${must ? "" : " (optional)"}.</b>\nTap the button below and Telegram fills it in. It is kept with your account and shown only to the site's staff.`,
  share: "Share my number",
  skip: "Skip",
  notYours: "That is somebody else's contact. Use the button, so it's your own number.",
  needed: "Your number is needed to go on. Use the button below.",
  okNew: "✅ <b>Verified.</b> One last step on the website: choose your login and password.",
  okKnown: "✅ <b>It's you.</b> The website is signing you in.",
  okReset: "✅ <b>It's you.</b> Go back to the website and choose a new password.",
  okLink: "✅ <b>Linked.</b> You can go back to the website.",
  failLink: "⚠️ This Telegram couldn't be linked. Please try again from the website.",
  finish: "Finish on the website",
  signIn: "Sign in",
  newPassword: "Set a new password",
  hint: "If the website didn't move on by itself, use this button. It works once, for 30 minutes.",
  ready: (login) => `🎉 <b>Your account is ready.</b>\nSign in with <b>${esc(login)}</b> and your password, or with Telegram.`,
  alert: (tg, login, phone, where) => ["🆕 <b>New account</b>", esc(fullName(tg) || "No name") + (tg.username ? " @" + esc(tg.username) : ""), esc(login), esc(phone), esc(where)].filter(Boolean).join("\n"),
  error: "⚠️ Something went wrong on our side. Please try again in a moment."
});

const DEFAULTS = {
  siteName: "this site",
  base: "/api/tg",
  origin: "",
  secret: "",
  botToken: "",
  updates: "webhook",
  apiBase: "https://api.telegram.org",
  joinPath: "/?join=",
  minPassword: 6,
  maxTries: 10,
  ttl: 15 * 60e3,
  finishTtl: 30 * 60e3,
  limits: { perIp: 60, total: 1000 },
  text: {}
};
const SETTINGS = { bot: null, webhook: "", origin: "", connectedAt: null, mode: "telegram", phone: "ask", gate: null, notify: false };
const MODES = ["telegram", "both", "closed"], PHONES = ["off", "ask", "required"];
const UPDATES = ["message", "callback_query"];
const clean = (s) => ({ ...SETTINGS, ...s, mode: MODES.includes(s?.mode) ? s.mode : "telegram", phone: PHONES.includes(s?.phone) ? s.phone : "ask" });
const inline = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const keyboard = (rows) => ({ reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: true } });
const noKeyboard = { reply_markup: { remove_keyboard: true } };

export function createTgVerify(config) {
  const c = { ...DEFAULTS, ...config };
  const { store, app } = c;
  const say = { ...defaultText(c.siteName), ...c.text };
  const send = c.fetch || ((...a) => fetch(...a));
  const log = (userId, action, detail) => Promise.resolve().then(() => app.log?.(userId, action, detail)).catch(() => {});
  let tablesReady = false;

  async function ready() {
    if (!tablesReady) tablesReady = await store.ready();
    return tablesReady;
  }

  async function sealKey() {
    if (!c.secret) throw new UserError("The server has no `secret`, so the bot token can't be stored safely.", 500);
    return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode("bot-token:" + c.secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function seal(value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return toB64(iv) + "." + toB64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(), enc.encode(value)));
  }
  async function unseal(value) {
    try {
      const [iv, ct] = String(value).split(".");
      return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await sealKey(), fromB64(ct)));
    } catch {
      return "";
    }
  }
  async function hookSecret(token) {
    const key = await crypto.subtle.importKey("raw", enc.encode(c.secret || "dev"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", key, enc.encode("tg-webhook:" + token)));
  }

  async function load() {
    if (!await ready()) return { token: "", source: null, settings: clean({}), ready: false };
    const [raw, sealed] = await Promise.all([store.getConfig("settings"), store.getConfig("bot_token")]);
    let settings = clean({});
    try {
      settings = clean(JSON.parse(raw || "{}"));
    } catch {}
    const token = c.botToken || (sealed ? await unseal(sealed) : "");
    return { token, source: c.botToken ? "secret" : sealed ? (token ? "saved" : "unreadable") : null, settings, ready: !!(token && settings.bot) };
  }
  const saveSettings = (s) => store.setConfig("settings", JSON.stringify(clean(s)));

  function client(token) {
    const call = async (method, body) => {
      let data;
      try {
        data = await (await send(`${c.apiBase}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })).json();
      } catch {
        throw new TelegramError(0, "Telegram couldn't be reached.");
      }
      if (!data.ok) throw new TelegramError(data.error_code, data.description);
      return data.result;
    };
    const extra = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    return {
      call,
      send: (chat, text, more) => call("sendMessage", { chat_id: chat, text, ...extra, ...more }),
      edit: (chat, id, text, more) => call("editMessageText", { chat_id: chat, message_id: id, text, ...extra, ...more }),
      answer: (id, text) => call("answerCallbackQuery", { callback_query_id: id, text }),
      async member(chat, user) {
        const m = await call("getChatMember", { chat_id: chat, user_id: user });
        return ["creator", "administrator", "member"].includes(m.status) || (m.status === "restricted" && m.is_member === true);
      }
    };
  }

  function place(request) {
    const cf = request.cf || {}, ua = request.headers.get("user-agent") || "";
    const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone or iPad" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
    return { ip: clip(c.clientIp ? c.clientIp(request) : request.headers.get("cf-connecting-ip"), 60) || null, country: clip(cf.country, 8) || null, city: clip(cf.city, 80) || null, device: [browser, os].filter(Boolean).join(" on ") || null };
  }
  const where = (row) => [row.device, row.city, row.country].filter(Boolean).join(", ");

  async function ownerOf(tgId) {
    const link = tgId ? await store.account(tgId) : null;
    return link ? app.findUser(link.user_id) : null;
  }
  async function options() {
    const t = await load();
    const bot = t.ready ? t.settings.bot.username : null;
    if (t.settings.mode === "closed") return { mode: "closed", bot };
    return { mode: t.ready ? t.settings.mode : "plain", bot };
  }
  // The site's own sign-up route must ask this first, or people can walk around the verification.
  async function plainSignupAllowed() {
    return ["plain", "both"].includes((await options()).mode);
  }

  async function start(request) {
    const { purpose } = await request.json().catch(() => ({}));
    if (!["auth", "reset", "link"].includes(purpose)) return fail("Unknown request.");
    const user = purpose === "link" ? await app.currentUser(request) : null;
    if (purpose === "link" && !user) return fail("Not signed in", 401);
    const t = await load();
    if (!t.ready) return fail("Telegram isn't set up on this site yet.", 409);
    const at = place(request), since = later(-36e5);
    const [mine, all] = await Promise.all([at.ip ? store.countLogins({ ip: at.ip, since }) : 0, store.countLogins({ since })]);
    if (mine >= c.limits.perIp || all >= c.limits.total) return fail("Too many requests. Try again in an hour.", 429);
    const token = randomKey(20), poll = randomKey(32), code = randomInt(10, 99);
    const set = new Set([code]);
    while (set.size < 6) set.add(randomInt(10, 99));
    const order = [...set];
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    await store.addLogin({ id: crypto.randomUUID(), token_hash: await sha256(token), poll_hash: await sha256(poll), purpose, user_id: user ? String(user.id) : null, code, options: JSON.stringify(order), status: "new", tries: 0, ...at, created_at: now(), expires_at: later(c.ttl) });
    const name = t.settings.bot.username;
    return json({ token, poll, code, bot: name, url: `https://t.me/${name}?start=j_${token}`, ttl: c.ttl });
  }

  async function findLogin(body) {
    if (KEY32.test(body.fin || "")) return store.loginByFin(await sha256(body.fin));
    if (!KEY20.test(body.token || "") || !KEY32.test(body.poll || "")) return null;
    const row = await store.loginByToken(await sha256(body.token));
    return row && same(row.poll_hash, await sha256(body.poll)) ? row : null;
  }

  async function status(request) {
    const row = await findLogin(await request.json().catch(() => ({})));
    if (!row) return json({ st: "gone" });
    if (row.status === "done") return json({ st: "done" });
    if (row.status === "denied") return json({ st: "denied", why: row.why });
    if (expired(row)) return json({ st: "gone" });
    if (row.purpose === "link" && row.status === "verified") return json({ st: "asked" });
    const out = { st: row.status };
    if (["join", "phone", "verified"].includes(row.status)) out.name = fullName(JSON.parse(row.tg));
    if (row.status === "verified") {
      const user = await ownerOf(row.tg_id);
      Object.assign(out, { known: !!user, login: user ? maskLogin(user.login) : "", username: JSON.parse(row.tg).username });
    }
    return json(out);
  }

  async function finish(request, ctx) {
    const body = await request.json().catch(() => ({}));
    const row = await findLogin(body);
    if (!row || row.status !== "verified" || row.purpose === "link" || expired(row)) return fail(row?.status === "done" ? "That verification was already used. Sign in instead." : "This verification has run out. Start again.", 410);
    const tg = JSON.parse(row.tg), user = await ownerOf(row.tg_id);
    if (user?.blocked) return fail("This account is blocked.", 403);
    if (row.purpose === "reset" && !user) return fail("No account is linked to that Telegram.", 404);
    const need = user ? (row.purpose === "reset" ? "reset" : "login") : "details";
    if (body.check) return json({ need, name: fullName(tg), username: tg.username, login: user ? maskLogin(user.login) : "" });

    const take = async () => !!await store.moveLogin(row.id, ["verified"], { status: "done", done_at: now() });
    const used = () => fail("That verification was already used. Sign in instead.", 410);
    const enter = async (u, extra = {}) => {
      const s = (await app.signIn(u, request)) || {};
      return json({ ...s.body, ...extra, user: app.publicUser ? app.publicUser(u) : { id: u.id, login: u.login, name: u.name } }, 200, s.headers);
    };
    const password = String(body.password || "");

    if (need === "login") {
      if (!await take()) return used();
      ctx.waitUntil(Promise.all([log(user.id, "login", "Telegram"), store.updateAccount(row.tg_id, { ...profile(tg), last_seen_at: now() }).catch(() => {})]));
      return enter(user);
    }
    if (need === "reset") {
      if (password.length < c.minPassword) return fail(`Use at least ${c.minPassword} characters for the new password.`);
      if (!await take()) return used();
      await app.setPassword(user.id, password);
      ctx.waitUntil(log(user.id, "reset_password", "Telegram"));
      return enter(user);
    }

    if (!body.existing && (await options()).mode === "closed") return fail("New accounts are closed at the moment.", 403);
    if (!body.existing && password.length < c.minPassword) return fail(`Use at least ${c.minPassword} characters for the password.`);
    if (!await take()) return used();
    let account = null, created = null;
    try {
      const login = String(body.login || "").trim();
      if (body.existing) {
        account = await app.checkPassword(login, password);
        if (!account) throw new UserError("Wrong login or password.", 401);
        if (account.blocked) throw new UserError("This account is blocked.", 403);
        if (await store.accountOf(String(account.id))) throw new UserError("That account already has another Telegram linked.");
      } else {
        account = created = await app.createUser({ login, password, name: clip(String(body.name || "").trim(), 60) || fullName(tg) || null, telegram: tg, phone: row.phone, request });
      }
      await store.addAccount({ tg_id: row.tg_id, user_id: String(account.id), ...profile(tg), phone: row.phone, phone_shared_at: row.phone ? row.verified_at : null, linked_via: created ? "signup" : "link", ip: row.ip, country: row.country, city: row.city, device: row.device, verified_at: row.verified_at, last_seen_at: now() });
    } catch (e) {
      if (created) await Promise.resolve(app.deleteUser(created.id)).catch(() => {});
      const tries = (row.tries || 0) + 1, over = tries >= c.maxTries;
      await store.moveLogin(row.id, ["done"], over ? { status: "denied", why: "tries", tries, done_at: null } : { status: "verified", tries, done_at: null }).catch(() => {});
      if (over) return fail("Too many wrong tries. Start again.", 410);
      if (e instanceof UserError) return fail(e.message, e.status);
      if (e instanceof DuplicateError) return fail("That Telegram or that account is already linked. Sign in instead.", 409);
      console.error("tg-verify finish", e?.stack || e);
      return fail("The account couldn't be saved. Try again in a moment.", 503);
    }
    const handle = tg.username ? "@" + tg.username : String(tg.id);
    if (!created) {
      ctx.waitUntil(log(account.id, "link_telegram", handle));
      return enter(account, { linked: true });
    }
    ctx.waitUntil(Promise.all([log(created.id, "signup", "Telegram " + handle), greet(row, tg, created)]));
    return enter(created, { created: true });
  }

  async function greet(row, tg, user) {
    try {
      const t = await load(), api = client(t.token);
      await api.send(row.tg_id, say.ready(user.login), site(t)).catch(() => {});
      if (!t.settings.notify || !app.staffIds) return;
      for (const a of await store.accountsOf((await app.staffIds()).map(String))) await api.send(a.tg_id, say.alert(tg, user.login, row.phone, where(row))).catch(() => {});
    } catch (e) {
      console.error("tg-verify greet", e?.message);
    }
  }
  // Telegram refuses buttons that point at localhost, so there are none then.
  const linkable = (t) => /^https?:\/\/[^/]*\./.test(t.settings.origin);
  const site = (t, label = say.open, path = "/") => (linkable(t) ? inline([[{ text: label, url: t.settings.origin + path }]]) : {});

  async function webhook(request) {
    const t = await load();
    if (!t.token) return new Response("off", { status: 404 });
    if (!same(request.headers.get("x-telegram-bot-api-secret-token"), await hookSecret(t.token))) return new Response("bad secret", { status: 401 });
    await onUpdate(await request.json().catch(() => null), t);
    return new Response("ok");
  }
  async function onUpdate(update, t) {
    const api = client(t.token), m = update?.message, q = update?.callback_query;
    try {
      if (m && m.chat?.type === "private" && m.from && !m.from.is_bot) await onMessage(m, { t, api });
      else if (q && q.message?.chat?.type === "private") await onButton(q, { t, api });
    } catch (e) {
      console.error("tg-verify update", e?.stack || e);
      const chat = m?.chat?.id || q?.message?.chat?.id;
      if (chat) await api.send(chat, say.error).catch(() => {});
    }
  }

  async function onMessage(m, kit) {
    const { t, api } = kit, chat = m.chat.id, text = String(m.text || "").trim();
    const linked = await store.account(m.from.id);
    if (linked) await store.updateAccount(m.from.id, { ...profile(person(m.from)), last_seen_at: now() }).catch(() => {});
    const go = text.match(/^\/start(?:@\w+)?\s+j_([a-z0-9]{20})$/);
    if (go) return begin(m, go[1], kit);
    const waiting = m.contact || text === say.skip || /^skip$/i.test(text) ? await store.openLogin(m.from.id, "phone") : null;
    if (waiting) return phone(m, waiting, kit);
    if (/^\/id\b/.test(text)) return api.send(chat, say.id(m.from.id));
    const user = linked ? await app.findUser(linked.user_id) : null;
    return api.send(chat, user ? say.linked(m.from.first_name || "", maskLogin(user.login)) : say.welcome, site(t));
  }

  async function begin(m, token, kit) {
    const { t, api } = kit, chat = m.chat.id, from = m.from;
    const row = await store.loginByToken(await sha256(token));
    if (!row || expired(row)) return api.send(chat, say.expired, site(t));
    if (row.status !== "new" && !(row.status === "asked" && row.tg_id === from.id)) return api.send(chat, say.used, site(t));
    const user = await ownerOf(from.id);
    const mine = { tg_id: from.id, tg: JSON.stringify(person(from)) };
    const deny = async (why) => {
      await store.moveLogin(row.id, ["new", "asked"], { status: "denied", why, ...mine });
      return api.send(chat, say[why], site(t));
    };
    if (user?.blocked) return deny("blocked");
    if (row.purpose === "link" && user && !sameId(user.id, row.user_id)) return deny("taken");
    if (row.purpose === "reset" && !user) return deny("unknown");
    if (row.purpose === "auth" && !user && t.settings.mode === "closed") return deny("closed");
    if (!await store.moveLogin(row.id, ["new", "asked"], { status: "asked", ...mine })) return;
    const target = row.purpose === "link" ? await app.findUser(row.user_id) : user;
    const login = maskLogin(target?.login);
    const what = row.purpose === "link" ? say.toLink(login) : row.purpose === "reset" ? say.toReset(login) : user ? say.toSignIn(login) : say.toCreate;
    const nums = JSON.parse(row.options), btn = (n) => ({ text: String(n), callback_data: `n:${row.id}:${n}` });
    return api.send(chat, say.ask(from.first_name || "", what, where(row)), inline([nums.slice(0, 3).map(btn), nums.slice(3, 6).map(btn), [{ text: say.notMe, callback_data: `x:${row.id}` }]]));
  }

  async function onButton(q, kit) {
    const { t, api } = kit, [kind, id, value] = String(q.data || "").split(":");
    if (!/^[0-9a-f-]{36}$/.test(id || "") || !["n", "x", "j"].includes(kind)) return api.answer(q.id);
    const row = await store.loginById(id), chat = q.message.chat.id, msg = q.message.message_id;
    if (!row || row.tg_id !== q.from.id || expired(row)) {
      await api.answer(q.id);
      return api.edit(chat, msg, say.expired, site(t)).catch(() => {});
    }
    await api.answer(q.id).catch(() => {});
    if (kind === "x" || (kind === "n" && Number(value) !== Number(row.code))) {
      const moved = await store.moveLogin(row.id, kind === "x" ? ["asked", "join", "phone"] : ["asked"], { status: "denied", why: kind === "x" ? "refused" : "number" });
      if (moved) await api.edit(chat, msg, kind === "x" ? say.refused : say.wrong, site(t));
      return;
    }
    if (kind === "n" && row.status === "asked") return next(row, { ...kit, chat, msg, from: q.from });
    if (kind === "j" && row.status === "join") return next(row, { ...kit, chat, msg, from: q.from, again: true });
  }

  async function next(row, kit) {
    const { t, api, chat, msg, from, again } = kit, gate = t.settings.gate;
    const fresh = row.purpose === "auth" && !await ownerOf(from.id);
    if (fresh && gate) {
      let inside = true;
      try {
        inside = await api.member(gate.chat, from.id);
      } catch (e) {
        console.error("tg-verify gate", e?.message);
      }
      if (!inside) {
        await store.moveLogin(row.id, ["asked", "join"], { status: "join" });
        return api.edit(chat, msg, say.join(gate.title, again), inline([...(gate.url ? [[{ text: say.openChannel(gate.title), url: gate.url }]] : []), [{ text: say.joined, callback_data: `j:${row.id}` }], [{ text: say.notMe, callback_data: `x:${row.id}` }]])).catch((e) => {
          if (!/not modified/i.test(e.message)) throw e;
        });
      }
    }
    if (fresh && t.settings.phone !== "off") {
      const must = t.settings.phone === "required";
      if (!await store.moveLogin(row.id, ["asked", "join"], { status: "phone" })) return;
      await api.edit(chat, msg, say.matched).catch(() => {});
      return api.send(chat, say.phone(must), keyboard([[{ text: say.share, request_contact: true }], ...(must ? [] : [[{ text: say.skip }]])]));
    }
    return verified(row, kit);
  }

  async function phone(m, row, kit) {
    const { t, api } = kit, chat = m.chat.id, card = m.contact;
    if (card && card.user_id !== m.from.id) return api.send(chat, say.notYours);
    if (!card && t.settings.phone === "required") return api.send(chat, say.needed);
    const number = card ? "+" + String(card.phone_number || "").replace(/\D/g, "").slice(0, 15) : null;
    return verified({ ...row, phone: number }, { ...kit, chat, from: m.from, keyboard: true, patch: { phone: number } });
  }

  async function verified(row, kit) {
    const { t, api, chat, msg, from, patch = {} } = kit, steps = ["asked", "join", "phone"];
    const stopped = async () => {
      const cur = await store.loginById(row.id);
      if (cur && ["verified", "done"].includes(cur.status)) return;
      return api.send(chat, say.expired, noKeyboard);
    };
    if (row.purpose === "link") {
      if (!await store.moveLogin(row.id, steps, { status: "verified", verified_at: now() })) return stopped();
      const ok = await link(row, from);
      await store.moveLogin(row.id, ["verified"], ok ? { status: "done", done_at: now() } : { status: "denied", why: "link" });
      return api.edit(chat, msg, ok ? say.okLink : say.failLink, site(t));
    }
    const fin = randomKey(32);
    if (!await store.moveLogin(row.id, steps, { ...patch, status: "verified", verified_at: now(), expires_at: later(c.finishTtl), fin_hash: await sha256(fin) })) return stopped();
    const known = !!await ownerOf(from.id), reset = row.purpose === "reset";
    const text = reset ? say.okReset : known ? say.okKnown : say.okNew;
    const button = site(t, reset ? say.newPassword : known ? say.signIn : say.finish, c.joinPath + fin);
    if (!kit.keyboard) return api.edit(chat, msg, text + (linkable(t) ? "\n\n" + say.hint : ""), button);
    await api.send(chat, text, noKeyboard);
    if (linkable(t)) await api.send(chat, say.hint, button);
  }

  async function link(row, from) {
    const base = { ...profile(person(from)), ip: row.ip, country: row.country, city: row.city, device: row.device, last_seen_at: now() };
    try {
      const mine = await store.accountOf(row.user_id);
      if (mine && mine.tg_id === from.id) await store.updateAccount(from.id, base);
      else {
        if (await store.account(from.id)) return false;
        if (mine) await store.removeAccount(row.user_id);
        await store.addAccount({ tg_id: from.id, user_id: row.user_id, phone: null, phone_shared_at: null, linked_via: "link", verified_at: now(), ...base });
      }
      await log(row.user_id, "link_telegram", from.username ? "@" + from.username : String(from.id));
      return true;
    } catch (e) {
      console.error("tg-verify link", e?.message);
      return false;
    }
  }

  async function overview() {
    const ok = await ready(), t = await load();
    let info = null;
    if (t.token) {
      try {
        const w = await client(t.token).call("getWebhookInfo");
        info = { url: w.url, pending: w.pending_update_count, error: w.pending_update_count ? w.last_error_message || null : null, errorAt: w.last_error_date ? w.last_error_date * 1e3 : null };
      } catch (e) {
        info = { failed: e.message };
      }
    }
    const { mode, phone, gate, notify, bot, webhook: hook, connectedAt } = t.settings;
    return { tables: ok, ready: t.ready, source: t.source, canStore: !!c.secret, updates: c.updates, bot, webhook: hook, connectedAt, settings: { mode, phone, gate, notify }, info };
  }

  async function introduce(api) {
    for (const [what, field, text] of [["Description", "description", say.about], ["ShortDescription", "short_description", say.short]]) {
      try {
        const cur = await api.call("getMy" + what);
        if (!cur?.[field]) await api.call("setMy" + what, { [field]: text });
      } catch (e) {
        console.error("tg-verify about", e?.message);
      }
    }
  }

  async function connect(body, url, actor) {
    if (!await ready()) return fail("Create the database tables first (schema file), then try again.", 409);
    const origin = (c.origin || url.origin).replace(/\/$/, "");
    if (c.updates === "webhook" && !c.fetch && c.apiBase === DEFAULTS.apiBase && !origin.startsWith("https://")) return fail("Open the live https site to connect the bot.");
    const pasted = String(body.token || "").trim();
    if (pasted && !/^\d{5,14}:[A-Za-z0-9_-]{30,60}$/.test(pasted)) return fail("That doesn't look like a bot token. BotFather's tokens look like 123456789:ABC…");
    const t = await load(), token = pasted || t.token;
    if (!token) return fail("Paste the bot token first.");
    const api = client(token), hook = origin + c.base + "/webhook";
    let me;
    try {
      me = await api.call("getMe");
    } catch (e) {
      return fail([401, 404].includes(e.code) ? "Telegram refused that token. Copy it again from BotFather." : e.message);
    }
    if (!body.move) {
      const old = await api.call("getWebhookInfo").catch(() => null);
      if (old?.url && old.url !== hook) {
        let host = old.url;
        try {
          host = new URL(old.url).host;
        } catch {}
        return fail("This bot already works for " + host + ".", 409, { elsewhere: host, username: me.username });
      }
    }
    if (pasted) await store.setConfig("bot_token", await seal(pasted));
    try {
      if (c.updates === "polling") await api.call("deleteWebhook", {});
      else await api.call("setWebhook", { url: hook, secret_token: await hookSecret(token), allowed_updates: UPDATES, max_connections: 20, ...(body.move ? { drop_pending_updates: true } : {}) });
      await api.call("setMyCommands", { commands: [{ command: "start", description: say.open }, { command: "id", description: "Show my Telegram ID" }] });
    } catch (e) {
      return fail("The token works, but Telegram refused the connection: " + e.message);
    }
    await introduce(api);
    await saveSettings({ ...t.settings, bot: { id: me.id, username: me.username, name: me.first_name }, webhook: c.updates === "polling" ? "" : hook, origin, connectedAt: now() });
    await log(actor.id, "admin_telegram", "Connected @" + me.username);
    return json(await overview());
  }

  async function changeSettings(body, actor) {
    const t = await load(), s = { ...t.settings };
    if (MODES.includes(body.mode)) s.mode = body.mode;
    if (PHONES.includes(body.phone)) s.phone = body.phone;
    if (typeof body.notify === "boolean") s.notify = body.notify;
    if (body.gate !== undefined) {
      const chat = String(body.gate || "").trim().replace(/^https?:\/\/t\.me\//i, "@").replace(/^@@/, "@");
      if (!chat) s.gate = null;
      else {
        if (!/^(@[A-Za-z0-9_]{4,40}|-100\d{6,16})$/.test(chat)) return fail("Use the channel's @username, or its -100… ID for a private one.");
        if (!t.ready) return fail("Connect the bot first.");
        const api = client(t.token);
        try {
          const info = await api.call("getChat", { chat_id: chat });
          const me = await api.call("getChatMember", { chat_id: chat, user_id: t.settings.bot.id });
          if (!["administrator", "creator"].includes(me.status)) return fail("Make the bot an admin of that channel, then save again.");
          s.gate = { chat: String(info.id), title: info.title || chat, url: info.username ? "https://t.me/" + info.username : info.invite_link || "" };
        } catch {
          return fail("The bot can't see that channel. Add it there as an admin, then save again.");
        }
      }
    }
    await saveSettings(s);
    await log(actor.id, "admin_telegram", `Sign-up: ${s.mode}, phone ${s.phone}${s.gate ? ", must join " + s.gate.title : ""}, staff alerts ${s.notify ? "on" : "off"}`);
    return json(await overview());
  }

  async function disconnect(actor) {
    const t = await load();
    if (t.token) await client(t.token).call("deleteWebhook").catch(() => {});
    await store.setConfig("bot_token", "");
    await saveSettings({ ...t.settings, bot: null, webhook: "", connectedAt: null });
    await log(actor.id, "admin_telegram", "Disconnected the bot");
    return json(await overview());
  }

  async function people(url) {
    const size = Math.min(100, Math.max(1, parseInt(url.searchParams.get("size"), 10) || 30)), page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
    const { rows, total } = await store.listAccounts({ search: url.searchParams.get("q") || "", page, size });
    const ids = rows.map((r) => r.user_id);
    const users = ids.length ? (app.findUsers ? await app.findUsers(ids) : await Promise.all(ids.map((id) => app.findUser(id)))) : [];
    return json({ total, page, size, rows: rows.map((r) => {
      const u = users.find((x) => x && sameId(x.id, r.user_id));
      return { ...r, account: u ? { id: u.id, login: u.login, name: u.name || "", blocked: u.blocked || false } : null };
    }) });
  }

  async function admin(request, url, path) {
    const actor = await app.currentUser(request);
    if (!actor) return fail("Not signed in", 401);
    const role = await app.role(actor);
    if (!["owner", "staff"].includes(role)) return fail("Admin access required.", 403);
    const { method } = request;
    if (method === "GET") {
      if (path === "/admin") return json({ ...await overview(), owner: role === "owner" });
      if (!await ready()) return fail("Create the database tables first.", 409);
      if (path === "/admin/people") return people(url);
      if (path === "/admin/requests") return json((await store.listLogins(60)).map(({ id, purpose, status: st, why, tg_id, tg, phone: ph, ip, country, city, device, created_at, verified_at, done_at, expires_at }) => ({ id, purpose, status: st, why, tg_id, tg: tg ? JSON.parse(tg) : null, phone: ph, ip, country, city, device, created_at, verified_at, done_at, expires_at })));
      return null;
    }
    if (role !== "owner") return fail("Owner access required.", 403);
    if (path === "/admin" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const res = body.action === "connect" ? await connect(body, url, actor) : body.action === "disconnect" ? await disconnect(actor) : body.action === "settings" ? await changeSettings(body, actor) : fail("Unknown action.");
      if (res.status !== 200) return res;
      return json({ ...await res.json(), owner: true });
    }
    const gone = path.match(/^\/admin\/people\/([^/]+)$/);
    if (gone && method === "DELETE") {
      const id = decodeURIComponent(gone[1]);
      await store.removeAccount(id);
      await log(actor.id, "admin_telegram", "Unlinked the Telegram of user " + id);
      return json({ ok: true });
    }
    return null;
  }

  async function mine(request) {
    const user = await app.currentUser(request);
    if (!user) return fail("Not signed in", 401);
    const { bot } = await options(), a = await ready() ? await store.accountOf(String(user.id)) : null;
    return json({ bot, telegram: a ? { name: fullName(a), username: a.username, phone: a.phone, verifiedAt: a.verified_at } : null });
  }

  // Returns a Response for its own routes and null for everything else.
  async function handle(request, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(c.base + "/")) return null;
    const path = url.pathname.slice(c.base.length), post = request.method === "POST";
    const bg = { waitUntil: (p) => (ctx?.waitUntil ? ctx.waitUntil(p) : Promise.resolve(p).catch(() => {})) };
    try {
      if (path === "/webhook" && post) return await webhook(request);
      const from = request.headers.get("origin");
      if (from && request.method !== "GET") {
        const ok = [url.host, c.origin && new URL(c.origin).host].filter(Boolean);
        let host = "";
        try {
          host = new URL(from).host;
        } catch {}
        if (!ok.includes(host)) return fail("Wrong origin.", 403);
      }
      if (path === "/options" && request.method === "GET") return json(await options());
      if (path === "/me" && request.method === "GET") return await mine(request);
      if (post && path === "/start") return await start(request);
      if (post && path === "/status") return await status(request);
      if (post && path === "/finish") return await finish(request, bg);
      if (path === "/admin" || path.startsWith("/admin/")) return (await admin(request, url, path)) || fail("Not found", 404);
      return fail("Not found", 404);
    } catch (e) {
      if (e instanceof UserError) return fail(e.message, e.status);
      console.error("tg-verify", e?.stack || e);
      return fail("Something went wrong. Try again in a moment.", 500);
    }
  }

  // For servers Telegram can't reach over https: config.updates = "polling", then call poll() once at startup.
  async function poll({ signal } = {}) {
    let offset = 0;
    while (!signal?.aborted) {
      try {
        const t = await load();
        if (!t.ready) {
          await sleep(5000);
          continue;
        }
        for (const u of await client(t.token).call("getUpdates", { offset, timeout: 25, allowed_updates: UPDATES })) {
          offset = u.update_id + 1;
          await onUpdate(u, t);
        }
      } catch (e) {
        console.error("tg-verify poll", e?.message);
        await sleep(3000);
      }
    }
  }

  return {
    base: c.base,
    handle,
    options,
    plainSignupAllowed,
    poll,
    cleanup: async (days = 30) => (await ready() ? store.deleteLogins(later(-days * 864e5)) : null),
    forgetUser: async (userId) => (await ready() ? store.removeAccount(String(userId)) : null),
    telegramOf: async (userId) => (await ready() ? store.accountOf(String(userId)) : null)
  };
}

// Express or plain node:http: app.use(nodeHandler(tg)), before or after express.json(). Other routes are left untouched.
export function nodeHandler(tg) {
  return async (req, res, next) => {
    if (!(req.originalUrl || req.url).startsWith(tg.base + "/")) return next ? next() : false;
    let body = null;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.body !== undefined) body = typeof req.body === "string" || req.body instanceof Uint8Array ? req.body : JSON.stringify(req.body);
      else {
        const parts = [];
        for await (const p of req) parts.push(p);
        body = Buffer.concat(parts);
      }
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !k.startsWith(":")) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const proto = req.headers["x-forwarded-proto"]?.split(",")[0] || (req.socket?.encrypted ? "https" : "http");
    const out = await tg.handle(new Request(`${proto}://${req.headers.host || "localhost"}${req.originalUrl || req.url}`, { method: req.method, headers, body }));
    if (!out) return next ? next() : false;
    res.statusCode = out.status;
    const cookies = out.headers.getSetCookie?.() || [];
    out.headers.forEach((v, k) => k !== "set-cookie" && res.setHeader(k, v));
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.end(Buffer.from(await out.arrayBuffer()));
    return true;
  };
}
