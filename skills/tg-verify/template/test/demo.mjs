// node demo.mjs [port]        the whole system with a pretend phone, in memory. Nothing leaves this computer.
// Accounts: owner@site.test, staff@site.test, student@site.test, password secret1. The bot is already connected.
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { createTgVerify, nodeHandler, UserError } from "../server/tg-verify.mjs";
import { memoryStore } from "../server/store-memory.mjs";
import { TEST_TOKEN, createMockTelegram, mockRoutes } from "./mock-telegram.mjs";

const PORT = Number(process.argv[2]) || 8795, ORIGIN = "http://127.0.0.1:" + PORT;
const users = [], sessions = new Map();
const add = (login, role, password, name) => {
  const u = { id: users.length + 1, login, role, password, name: name || null, blocked: false };
  users.push(u);
  return u;
};
for (const role of ["owner", "staff", "student"]) add(role + "@site.test", role === "student" ? "user" : role, "secret1", role[0].toUpperCase() + role.slice(1));
const find = (id) => users.find((u) => String(u.id) === String(id)) || null;
const session = (u) => {
  const id = crypto.randomUUID();
  sessions.set(id, u.id);
  return `sid=${id}; Path=/; HttpOnly; SameSite=Lax`;
};
const who = (cookie) => find(sessions.get(String(cookie || "").match(/sid=([\w-]+)/)?.[1]));
const show = (u) => ({ id: u.id, login: u.login, name: u.name, role: u.role });
let tg;
const mock = createMockTelegram({ deliver: (body, headers) => tg.handle(new Request(ORIGIN + "/api/tg/webhook", { method: "POST", headers, body })) });
tg = createTgVerify({
  siteName: "Demo Site", secret: "demo", origin: ORIGIN, store: memoryStore(), fetch: mock.fetch, clientIp: () => "127.0.0.1",
  app: {
    findUser: async (id) => find(id),
    findUsers: async (ids) => ids.map(find).filter(Boolean),
    async createUser({ login, password, name }) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) throw new UserError("Enter a valid email.");
      if (users.some((u) => u.login === login)) throw new UserError("That email already has an account.", 409);
      return add(login, "user", password, name);
    },
    checkPassword: async (login, password) => users.find((u) => u.login === login && u.password === password) || null,
    setPassword: async (id, password) => void (find(id).password = password),
    deleteUser: async (id) => void users.splice(users.findIndex((u) => u.id === id), 1),
    signIn: async (u) => ({ headers: { "set-cookie": session(u) } }),
    publicUser: show,
    currentUser: async (req) => who(req.headers.get("cookie")),
    role: async (u) => u.role,
    staffIds: async () => users.filter((u) => u.role !== "user").map((u) => u.id)
  }
});
const ownerCookie = session(users[0]);
await tg.handle(new Request(ORIGIN + "/api/tg/admin", { method: "POST", headers: { cookie: ownerCookie }, body: JSON.stringify({ action: "connect", token: TEST_TOKEN }) }));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>tg-verify demo</title><link rel="stylesheet" href="/client/tg.css"><style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#e9edf2;color:#17202c}@media(prefers-color-scheme:dark){body{background:#0d1219;color:#e8edf4}.box,.phone{background:#151b24!important;border-color:#364150!important}.msg{background:#1d2530!important}}
main{display:grid;gap:20px;max-width:1180px;margin:0 auto;padding:16px;grid-template-columns:minmax(0,1fr)}@media(min-width:900px){main{grid-template-columns:minmax(0,1fr) 340px}}
.box{background:#fff;border:1px solid #cfd6df;border-radius:14px;padding:22px;min-width:0}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}nav button,.phone button{font:inherit;min-height:40px;padding:0 14px;border:1px solid #cfd6df;border-radius:8px;background:none;color:inherit;cursor:pointer}nav button[aria-current=true]{background:#1f6feb;color:#fff}
.phone{position:sticky;top:16px;align-self:start;background:#fff;border:1px solid #cfd6df;border-radius:26px;padding:16px;min-width:0}.chat{display:grid;gap:10px;max-height:56vh;overflow:auto;margin:12px 0}.msg{background:#f1f4f8;border-radius:12px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.93rem}.keys{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.phone h2{margin:0;font-size:1rem}.phone p{margin:4px 0;font-size:.86rem;opacity:.8}</style></head>
<body><main><section class="box"><nav><button data-t="in">Sign in</button><button data-t="account">Account</button><button data-t="admin">Admin</button><button data-out>Sign out</button></nav><div id="app"></div></section>
<aside class="phone"><h2>Pretend phone</h2><p>Aman Kumar, @aman_k. Press "Open Telegram" on the left and the bot answers here.</p><div class="chat" id="chat"></div><div class="keys" id="keys"></div></aside></main>
<script type="module">
import { mountTgAuth, mountTgLink, api, html, raw, paint } from "/client/tg-client.js";
import { mountTgAdmin } from "/client/tg-admin.js";
const app = document.querySelector("#app"), aman = { id: 5551, first_name: "Aman", last_name: "Kumar", username: "aman_k", language_code: "hi" };
const views = {
  in: () => mountTgAuth(app, { signIn: (login, password) => api("/api/login", { login, password }), signUp: (login, password) => api("/api/signup", { login, password }), onSignedIn: (u) => { paint(app, html\`<div class="tgv tgv-stack"><h1>Signed in</h1><p data-who>\${u.login} (\${u.name || "no name"})</p></div>\`); } }),
  account: () => mountTgLink(app),
  admin: () => mountTgAdmin(app)
};
let stop = null;
const show = (t) => { document.querySelectorAll("[data-t]").forEach((b) => b.setAttribute("aria-current", b.dataset.t === t)); stop?.stop?.(); app.replaceChildren(); stop = views[t](); };
document.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => show(b.dataset.t));
document.querySelector("[data-out]").onclick = async () => { await api("/api/logout", {}); show("in"); };
const act = async (path, body) => { await api(path, { user: aman, ...body }); draw(); };
async function draw() {
  const { messages, keyboard } = await api("/__chat?id=5551");
  const chat = document.querySelector("#chat"), sig = JSON.stringify([messages, keyboard]);
  if (chat.dataset.sig === sig) return;
  chat.dataset.sig = sig;
  paint(chat, html\`\${messages.map((m) => html\`<div class="msg"><div>\${raw(m.text)}</div><div class="keys">\${m.buttons.flat().map((b) => html\`<button data-b="\${b.text}" data-u="\${b.url || ""}">\${b.text}</button>\`)}</div></div>\`)}\`);
  paint(document.querySelector("#keys"), html\`\${(keyboard || []).flat().map((k) => html\`<button data-k="\${k.request_contact ? "share" : k.text}">\${k.text}</button>\`)}\`);
  chat.scrollTop = chat.scrollHeight;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="https://t.me/"]'), b = e.target.closest("[data-b]"), k = e.target.closest("[data-k]");
  if (a && a.href.includes("start=")) { e.preventDefault(); act("/__open", { url: a.href }); }
  if (b) b.dataset.u ? (location.href = b.dataset.u) : act("/__tap", { label: b.dataset.b });
  if (k) k.dataset.k === "share" ? act("/__share", { phone: "910000012345" }) : act("/__say", { text: k.dataset.k });
});
setInterval(draw, 800);
draw();
show("in");
</script></body></html>`;

const api = nodeHandler(tg), phone = mockRoutes(mock);
const TYPES = { js: "text/javascript", css: "text/css" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN), json = (data, status = 200, cookie) => {
    res.writeHead(status, { "content-type": "application/json", ...(cookie ? { "set-cookie": cookie } : {}) });
    res.end(JSON.stringify(data));
  };
  if (url.pathname.startsWith("/api/tg/")) return api(req, res);
  const file = url.pathname.match(/^\/client\/([\w-]+\.(js|css))$/);
  if (file) {
    const path = new URL("../client/" + file[1], import.meta.url);
    if (!fs.existsSync(path)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[file[2]], "cache-control": "no-store" });
    return res.end(fs.readFileSync(path));
  }
  let body = "";
  for await (const p of req) body += p;
  if (await phone(req, res, url, body)) return;
  if (req.method === "POST" && url.pathname === "/api/logout") {
    sessions.delete(String(req.headers.cookie || "").match(/sid=([\w-]+)/)?.[1]);
    return json({ ok: true });
  }
  if (req.method === "POST" && ["/api/login", "/api/signup"].includes(url.pathname)) {
    const { login, password } = JSON.parse(body || "{}");
    if (url.pathname === "/api/login") {
      const u = users.find((x) => x.login === login && x.password === password);
      return u ? json({ user: show(u) }, 200, session(u)) : json({ error: "Wrong email or password." }, 401);
    }
    if (!await tg.plainSignupAllowed()) return json({ error: "Create your account with Telegram." }, 403);
    const u = add(login, "user", password);
    return json({ user: show(u) }, 200, session(u));
  }
  if (url.pathname !== "/") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(PAGE);
}).listen(PORT, "127.0.0.1", () => console.log("tg-verify demo on " + ORIGIN));
