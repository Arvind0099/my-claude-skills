// A complete Cloudflare Worker with accounts in D1. For a site that already has accounts, copy only tgFor() and the two
// marked lines in fetch(), and point `app` at the site's own functions.
//   wrangler.toml: [[d1_databases]] binding = "DB"     [triggers] crons = ["0 3 * * *"]
//   npx wrangler secret put SESSION_SECRET        (a long random string)
//   users table: create table users (id integer primary key, email text unique not null, name text, pass text not null, role text not null default 'user', status text not null default 'active');
import { createTgVerify, UserError } from "../server/tg-verify.mjs";
import { d1Store } from "../server/store-sql.mjs";

const enc = new TextEncoder();
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

async function hash(password, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return salt + ":" + hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 }, key, 256));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function sign(env, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode("session:" + text)));
}
async function cookieFor(env, user, request) {
  const body = user.id + "." + (Date.now() + 30 * 864e5);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `sid=${body}.${await sign(env, body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

const shape = (r) => (r ? { id: r.id, login: r.email, name: r.name, role: r.role, blocked: r.status === "active" ? false : r.status } : null);
const usersOf = (env) => {
  const one = async (sql, ...p) => env.DB.prepare(sql).bind(...p).first();
  return {
    byId: async (id) => shape(await one("select * from users where id = ?", id)),
    async create(email, password, name) {
      email = String(email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Enter a valid email.");
      if (password.length < 6) throw new UserError("Use at least 6 characters for the password.");
      try {
        return shape(await one("insert into users (email, name, pass) values (?, ?, ?) returning *", email, name || null, await hash(password)));
      } catch (e) {
        if (/unique/i.test(e.message)) throw new UserError("That email already has an account.", 409);
        throw e;
      }
    },
    async check(email, password) {
      const r = await one("select * from users where email = ?", String(email || "").trim().toLowerCase());
      const ok = equal(await hash(password, r ? r.pass.split(":")[0] : "none"), r ? r.pass : "none:");
      return r && ok ? shape(r) : null;
    },
    setPassword: async (id, password) => void (await env.DB.prepare("update users set pass = ? where id = ?").bind(await hash(password), id).run()),
    remove: async (id) => void (await env.DB.prepare("delete from users where id = ?").bind(id).run()),
    many: async (ids) => (await env.DB.prepare(`select * from users where id in (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results.map(shape),
    staff: async () => (await env.DB.prepare("select id from users where role in ('owner', 'staff') and status = 'active'").all()).results.map((r) => r.id)
  };
};
async function currentUser(env, request) {
  const m = request.headers.get("cookie")?.match(/(?:^|; )sid=(\d+)\.(\d+)\.([0-9a-f]{64})/);
  if (!m || Number(m[2]) < Date.now() || !equal(m[3], await sign(env, m[1] + "." + m[2]))) return null;
  const user = await usersOf(env).byId(m[1]);
  return user && !user.blocked ? user : null;
}

export function tgFor(env) {
  const users = usersOf(env);
  return createTgVerify({
    siteName: env.SITE_NAME || "My Site",
    secret: env.SESSION_SECRET,
    botToken: env.TELEGRAM_BOT_TOKEN,
    apiBase: env.TELEGRAM_API || "https://api.telegram.org",
    store: d1Store(env.DB),
    app: {
      findUser: users.byId,
      findUsers: users.many,
      createUser: ({ login, password, name }) => users.create(login, password, name),
      checkPassword: users.check,
      setPassword: users.setPassword,
      deleteUser: users.remove,
      signIn: async (user, request) => ({ headers: { "set-cookie": await cookieFor(env, user, request) } }),
      currentUser: (request) => currentUser(env, request),
      role: (user) => user.role,
      staffIds: users.staff
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), tg = tgFor(env);
    const res = await tg.handle(request, ctx); // 1. the whole Telegram system
    if (res) return res;
    if (request.method === "POST" && url.pathname === "/api/signup") {
      if (!await tg.plainSignupAllowed()) return json({ error: "Create your account with Telegram." }, 403); // 2. closes the way around it
      try {
        const b = await request.json();
        const user = await usersOf(env).create(b.login, String(b.password || ""), b.name);
        return json({ user }, 200, { "set-cookie": await cookieFor(env, user, request) });
      } catch (e) {
        return e instanceof UserError ? json({ error: e.message }, e.status) : json({ error: "Something went wrong." }, 500);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/login") {
      const b = await request.json().catch(() => ({}));
      const user = await usersOf(env).check(b.login, String(b.password || ""));
      if (!user || user.blocked) return json({ error: user ? "This account is blocked." : "Wrong email or password." }, 401);
      return json({ user }, 200, { "set-cookie": await cookieFor(env, user, request) });
    }
    if (url.pathname === "/api/me") return json({ user: await currentUser(env, request) });
    if (request.method === "POST" && url.pathname === "/api/logout") return json({ ok: true }, 200, { "set-cookie": "sid=; Path=/; Max-Age=0" });
    return new Response("Not found", { status: 404 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tgFor(env).cleanup(30));
  }
};
