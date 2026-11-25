// node e2e.mjs        the whole flow against an in-memory site and the mock Telegram. No network, no real bot.
// import { runAll } from "./e2e.mjs"; await runAll(store)        the same checks against a project's own store (use an empty test database).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createTgVerify, nodeHandler, UserError } from "../server/tg-verify.mjs";
import { memoryStore } from "../server/store-memory.mjs";
import { BOT, TEST_TOKEN, createMockTelegram } from "./mock-telegram.mjs";

export async function runAll(store = memoryStore()) {
  const ORIGIN = "https://site.test", users = [], logs = [];
  let nextId = 1, tg;
  const add = (login, role = "user", password = "secret1", name = null) => {
    const u = { id: nextId++, login, role, password, name, blocked: false };
    users.push(u);
    return u;
  };
  const owner = add("owner@site.test", "owner"), staff = add("staff@site.test", "staff"), stu = add("student@site.test");
  const find = (id) => users.find((u) => String(u.id) === String(id)) || null;
  const app = {
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
    signIn: async (u) => ({ headers: { "set-cookie": `sid=${u.id}; Path=/; HttpOnly` } }),
    currentUser: async (req) => find(req.headers.get("cookie")?.match(/sid=(\d+)/)?.[1]),
    role: async (u) => u.role,
    staffIds: async () => users.filter((u) => u.role !== "user").map((u) => u.id),
    log: async (userId, action, detail) => void logs.push({ userId, action, detail })
  };
  const mock = createMockTelegram({ deliver: (body, headers) => tg.handle(new Request(ORIGIN + "/api/tg/webhook", { method: "POST", headers, body })) });
  const build = (extra) => createTgVerify({ siteName: "Test <Site>", secret: "test-secret", store, app, fetch: mock.fetch, clientIp: () => "203.0.113.9", ...extra });
  tg = build();
  const jobs = [];
  const call = async (path, body, { as, method, headers } = {}) => {
    const res = await tg.handle(new Request(ORIGIN + "/api/tg" + path, { method: method || (body ? "POST" : "GET"), headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537", ...(as ? { cookie: "sid=" + as.id } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), { waitUntil: (p) => jobs.push(p) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie") };
  };
  const person = (id, first_name, username) => ({ id, first_name, last_name: "Kumar", username, language_code: "hi", is_premium: true });
  const begin = async (purpose, as) => (await call("/start", { purpose }, { as })).data;
  const st = async (r) => (await call("/status", { token: r.token, poll: r.poll })).data;
  const done = (r, body) => call("/finish", { token: r.token, poll: r.poll, ...body });
  const settings = (s) => call("/admin", { action: "settings", ...s }, { as: owner });

  // before the bot is connected
  assert.equal(await tg.handle(new Request(ORIGIN + "/elsewhere")), null, "other routes are left alone");
  assert.deepEqual((await call("/options")).data, { mode: "plain", bot: null });
  assert.equal(await tg.plainSignupAllowed(), true);
  assert.equal((await call("/start", { purpose: "auth" })).status, 409);
  assert.equal((await tg.handle(new Request(ORIGIN + "/api/tg/webhook", { method: "POST", body: "{}" }))).status, 404);
  assert.equal((await call("/admin")).status, 401);
  assert.equal((await call("/admin", null, { as: stu })).status, 403);
  assert.equal((await call("/admin", { action: "connect", token: TEST_TOKEN }, { as: staff })).status, 403);
  assert.equal((await call("/admin", { action: "connect", token: TEST_TOKEN }, { as: owner, headers: { origin: "https://evil.test" } })).status, 403, "another site can't post here");

  // connecting
  assert.match((await call("/admin", { action: "connect", token: "nope" }, { as: owner })).data.error, /doesn't look like/);
  assert.match((await call("/admin", { action: "connect", token: "123456789:" + "x".repeat(35) }, { as: owner })).data.error, /refused that token/);
  await mock.fetch(`/bot${TEST_TOKEN}/setWebhook`, { body: JSON.stringify({ url: "https://other.test/hook" }) });
  let r = await call("/admin", { action: "connect", token: TEST_TOKEN }, { as: owner });
  assert.deepEqual([r.status, r.data.elsewhere, r.data.username], [409, "other.test", BOT.username], "a bot that works elsewhere isn't taken over silently");
  assert.equal(mock.hook().url, "https://other.test/hook");
  assert.equal(await store.getConfig("bot_token"), "", "nothing stored until confirmed");
  r = await call("/admin", { action: "connect", token: TEST_TOKEN, move: true }, { as: owner });
  assert.deepEqual([r.status, r.data.ready, r.data.owner, r.data.bot.username], [200, true, true, BOT.username], JSON.stringify(r.data));
  assert.deepEqual([mock.hook().url, mock.hook().drop_pending_updates], [ORIGIN + "/api/tg/webhook", true]);
  assert.match(mock.hook().secret_token, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(r.data).includes("TEST_TOKEN"), "the token is never sent back");
  assert.ok(!(await store.getConfig("bot_token")).includes("TEST_TOKEN"), "the token is stored sealed");
  assert.ok(mock.calls.some((x) => x.method === "setMyDescription" && x.body.description.length <= 512));
  assert.ok(mock.calls.some((x) => x.method === "setMyShortDescription" && x.body.short_description.length <= 120));
  const abouts = mock.calls.filter((x) => /^setMy(Short)?Description/.test(x.method)).length;
  await call("/admin", { action: "connect", token: "" }, { as: owner });
  assert.equal(mock.calls.filter((x) => /^setMy(Short)?Description/.test(x.method)).length, abouts, "an existing description is kept");
  assert.equal(mock.hook().drop_pending_updates, undefined);
  assert.deepEqual((await call("/options")).data, { mode: "telegram", bot: BOT.username });
  assert.equal(await tg.plainSignupAllowed(), false, "connecting closes the plain sign-up");
  assert.equal((await mock.push({ message: {} }, "wrong")).status, 401);
  assert.equal(build({ secret: "other" }) && (await build({ secret: "other" }).options()).mode, "plain", "another secret can't read the token");

  // sign up
  const aman = person(5551, "Aman", "aman_k");
  r = await begin("auth");
  assert.match(r.url, /^https:\/\/t\.me\/tg_verify_test_bot\?start=j_[a-z0-9]{20}$/);
  assert.deepEqual(await st(r), { st: "new" });
  assert.equal((await call("/status", { token: r.token, poll: "a".repeat(32) })).data.st, "gone", "the poll key is needed");
  await mock.open(aman, r.url);
  assert.deepEqual(await st(r), { st: "asked" }, "no name before the number is matched");
  assert.equal(mock.buttons(5551).length, 7);
  assert.ok(mock.buttons(5551).every((b) => b.callback_data.length <= 64));
  await mock.open(person(999, "Thief", "t"), r.url);
  assert.match(mock.last(999).text, /already used/);
  const stolen = mock.buttons(5551).find((b) => b.text === String(r.code)).callback_data;
  await mock.press(person(1234, "Other", "o"), stolen, 1);
  assert.equal((await st(r)).st, "asked", "another person's tap doesn't count");
  assert.equal((await done(r, { login: "a@b.cc", password: "secret1" })).status, 410, "can't finish before verifying");
  await mock.tap(aman, r.code);
  assert.deepEqual(await st(r), { st: "phone", name: "Aman Kumar" });
  assert.equal(mock.keyboard(5551)[0][0].request_contact, true);
  await mock.share(aman, "911", 1);
  assert.match(mock.last(5551).text, /somebody else/);
  await mock.share(aman, "910000012345");
  assert.deepEqual(await st(r), { st: "verified", name: "Aman Kumar", known: false, login: "", username: "aman_k" });
  assert.equal(mock.keyboard(5551), null);
  assert.equal((await done(r, { login: "aman@site.test", password: "12" })).status, 400);
  assert.equal((await done(r, { login: "bad", password: "secret1" })).status, 400);
  assert.equal((await done(r, { login: "student@site.test", password: "secret1" })).status, 409);
  assert.equal((await st(r)).st, "verified", "a mistake doesn't burn the verification");
  let f = await done(r, { login: "aman@site.test", password: "secret9", name: "Aman K" });
  assert.deepEqual([f.status, f.data.user.login, f.data.created], [200, "aman@site.test", true], JSON.stringify(f.data));
  const amanUser = users.find((u) => u.login === "aman@site.test");
  assert.equal(f.cookie.startsWith("sid=" + amanUser.id), true);
  assert.deepEqual([amanUser.name, amanUser.password], ["Aman K", "secret9"]);
  const row = await store.account(5551);
  assert.deepEqual([row.user_id, row.first_name, row.last_name, row.username, row.language_code, row.is_premium, row.phone, row.linked_via, row.device, row.ip], [String(amanUser.id), "Aman", "Kumar", "aman_k", "hi", true, "+910000012345", "signup", "Chrome on Windows", "203.0.113.9"]);
  assert.ok(row.verified_at && row.phone_shared_at && row.last_seen_at);
  assert.equal((await done(r, { login: "b@b.cc", password: "secret1" })).status, 410, "works once");
  await Promise.all(jobs);
  assert.match(mock.last(5551).text, /account is ready/);

  // sign in, refusals
  r = await begin("auth");
  await mock.open(aman, r.url);
  assert.match(mock.last(5551).text, /sign in as <b>am\*\*\*@site\.test/);
  await mock.tap(aman, r.code);
  assert.deepEqual(await st(r), { st: "verified", name: "Aman Kumar", known: true, login: "am***@site.test", username: "aman_k" });
  f = await done(r);
  assert.equal(f.data.user.login, "aman@site.test");
  r = await begin("auth");
  await mock.open(aman, r.url);
  await mock.tap(aman, mock.buttons(5551).find((b) => /^\d+$/.test(b.text) && b.text !== String(r.code)).text);
  assert.deepEqual(await st(r), { st: "denied", why: "number" });
  r = await begin("auth");
  await mock.open(aman, r.url);
  await mock.tap(aman, "Not me");
  assert.deepEqual(await st(r), { st: "denied", why: "refused" });
  amanUser.blocked = "banned";
  r = await begin("auth");
  await mock.open(aman, r.url);
  assert.deepEqual(await st(r), { st: "denied", why: "blocked" }, "a blocked person can't come back with Telegram");
  amanUser.blocked = false;

  // password reset, through the bot's button
  r = await begin("reset");
  await mock.open(aman, r.url);
  await mock.tap(aman, r.code);
  const link = new URL(mock.buttons(5551)[0].url), fin = link.searchParams.get("join");
  assert.equal(link.origin, ORIGIN);
  assert.deepEqual((await call("/finish", { fin, check: true })).data, { need: "reset", name: "Aman Kumar", username: "aman_k", login: "am***@site.test" });
  assert.equal((await call("/finish", { fin, password: "12" })).status, 400);
  assert.equal((await call("/finish", { fin, password: "brandnew1" })).status, 200);
  assert.equal(amanUser.password, "brandnew1");
  assert.equal((await call("/finish", { fin, password: "again123" })).status, 410);
  r = await begin("reset");
  await mock.open(person(404, "Nobody"), r.url);
  assert.deepEqual(await st(r), { st: "denied", why: "unknown" });

  // linking from the account page
  assert.equal((await call("/start", { purpose: "link" })).status, 401);
  assert.deepEqual((await call("/me", null, { as: stu })).data, { bot: BOT.username, telegram: null });
  r = await begin("link", stu);
  await mock.open(aman, r.url);
  assert.deepEqual(await st(r), { st: "denied", why: "taken" });
  const stuTg = person(6001, "Stu", "stu_tg");
  r = await begin("link", stu);
  await mock.open(stuTg, r.url);
  await mock.tap(stuTg, r.code);
  assert.equal((await st(r)).st, "done");
  assert.equal((await call("/me", null, { as: stu })).data.telegram.username, "stu_tg");
  assert.equal((await done(r)).status, 410, "a link request can't sign anybody in");
  const stuNew = person(6002, "Stu", "stu_new");
  r = await begin("link", stu);
  await mock.open(stuNew, r.url);
  await mock.tap(stuNew, r.code);
  assert.equal(await store.account(6001), null, "linking again replaces the old one");
  assert.equal((await store.account(6002)).user_id, String(stu.id));
  let midway = null;
  const shaky = { ...store, addAccount: async () => {
    midway = await done(r);
    throw new Error("down");
  } }, real = tg;
  tg = build({ store: shaky });
  r = await begin("link", owner);
  await mock.open(person(6100, "Own"), r.url);
  const err = console.error;
  console.error = () => {};
  await mock.tap(person(6100, "Own"), r.code);
  console.error = err;
  assert.equal(midway.status, 410, "a link request can't sign anybody in, even while it is being linked");
  assert.deepEqual(await st(r), { st: "denied", why: "link" }, "a failed link is never shown as linked");
  tg = real;

  // an existing account, linked while signing up; guessing its password is limited
  const adm = person(7001, "Adm", "adm_tg");
  r = await begin("auth");
  await mock.open(adm, r.url);
  await mock.tap(adm, r.code);
  await mock.say(adm, "Skip");
  assert.equal((await st(r)).st, "verified");
  assert.equal((await done(r, { existing: true, login: "staff@site.test", password: "bad" })).status, 401);
  f = await done(r, { existing: true, login: "staff@site.test", password: "secret1" });
  assert.deepEqual([f.status, f.data.linked, f.data.user.login], [200, true, "staff@site.test"]);
  assert.equal((await store.account(7001)).linked_via, "link");
  const guess = person(7002, "Guess");
  r = await begin("auth");
  await mock.open(guess, r.url);
  await mock.tap(guess, r.code);
  await mock.say(guess, "Skip");
  for (let i = 0; i < 9; i++) assert.equal((await done(r, { existing: true, login: "owner@site.test", password: "bad" + i })).status, 401);
  assert.equal((await done(r, { existing: true, login: "owner@site.test", password: "bad9" })).status, 410);
  assert.equal((await done(r, { existing: true, login: "owner@site.test", password: "secret1" })).status, 410, "guessing stops after 10 tries");
  const broken = person(7003, "Broken");
  const count = users.length;
  tg = build({ store: { ...store, addAccount: async () => { throw new Error("down"); } } });
  r = await begin("auth");
  await mock.open(broken, r.url);
  await mock.tap(broken, r.code);
  await mock.say(broken, "Skip");
  console.error = () => {};
  assert.equal((await done(r, { login: "half@site.test", password: "secret1" })).status, 503);
  console.error = err;
  assert.equal(users.length, count, "no half-made account is left behind");
  tg = real;

  // rules: channel, required number, staff alert, closed
  assert.match((await settings({ gate: "@nope_channel" })).data.error, /can't see/);
  r = await settings({ mode: "both", phone: "required", gate: "https://t.me/testchannel", notify: true });
  assert.deepEqual([r.data.settings.mode, r.data.settings.phone, r.data.settings.gate.title, r.data.settings.notify], ["both", "required", "Test Channel", true]);
  assert.equal(await tg.plainSignupAllowed(), true);
  const ravi = person(8001, "Ravi");
  r = await begin("auth");
  await mock.open(ravi, r.url);
  await mock.tap(ravi, r.code);
  assert.equal((await st(r)).st, "join");
  await mock.tap(ravi, "I joined");
  assert.equal((await st(r)).st, "join", "still has to join");
  mock.join(8001);
  await mock.tap(ravi, "I joined");
  assert.equal((await st(r)).st, "phone");
  await mock.say(ravi, "Skip");
  assert.match(mock.last(8001).text, /needed/);
  await mock.share(ravi, "+91 00000 67890");
  assert.equal((await done(r, { login: "ravi@site.test", password: "secret1" })).status, 200);
  await Promise.all(jobs);
  assert.match(mock.last(7001).text, /New account[\s\S]*ravi@site\.test[\s\S]*\+910000067890/, "staff alert");
  assert.equal(users.find((u) => u.login === "ravi@site.test").name, "Ravi Kumar", "the Telegram name is the fallback");
  await settings({ mode: "closed", gate: "", phone: "ask" });
  r = await begin("auth");
  await mock.open(person(9001, "New"), r.url);
  assert.deepEqual(await st(r), { st: "denied", why: "closed" });
  r = await begin("auth");
  await mock.open(aman, r.url);
  await mock.tap(aman, r.code);
  assert.equal((await st(r)).st, "verified", "linked people still get in");
  await settings({ mode: "telegram", notify: false });

  // admin lists
  r = await call("/admin/people?q=stu", null, { as: staff });
  assert.deepEqual([r.data.total, r.data.rows[0].account.login], [1, "student@site.test"]);
  assert.equal((await call("/admin/people?q=" + encodeURIComponent("+9100000678"), null, { as: staff })).data.total, 1, "search by mobile");
  assert.equal((await call("/admin/people?q=8001", null, { as: staff })).data.rows[0].tg_id, 8001, "search by ID");
  const list = await call("/admin/requests", null, { as: staff });
  assert.ok(list.data.length > 10);
  assert.ok(!/token_hash|poll_hash|fin_hash|"code"|"options"/.test(JSON.stringify(list.data)), "no secrets in the list");
  assert.equal((await call("/admin/people/" + amanUser.id, null, { as: staff, method: "DELETE" })).status, 403);
  assert.equal((await call("/admin/people/" + amanUser.id, null, { as: owner, method: "DELETE" })).status, 200);
  assert.equal(await store.account(5551), null);
  for (const a of ["signup", "login", "link_telegram", "reset_password", "admin_telegram"]) assert.ok(logs.some((l) => l.action === a), a);

  // odd updates
  await mock.say(person(321, "Guest"), "/start");
  assert.match(mock.last(321).text, /Welcome to Test &lt;Site&gt;/, "the site's name is escaped");
  await mock.say(stuNew, "/id");
  assert.match(mock.last(6002).text, /6002/);
  const before = mock.calls.length;
  await mock.push({ message: { message_id: 1, from: aman, chat: { id: -5, type: "group" }, text: "/start" } });
  assert.equal(mock.calls.length, before, "groups are ignored");
  await mock.say(person(322, "X"), "/start j_" + "a".repeat(20));
  assert.match(mock.last(322).text, /run out/);
  r = await begin("auth");
  await mock.open(person(323, "<b>&x"), r.url);
  assert.match(mock.last(323).text, /Hello &lt;b&gt;&amp;x/, "names are escaped");
  tg = build({ text: { welcome: "Namaste" } });
  await mock.say(person(324, "Y"), "/start");
  assert.equal(mock.last(324).text, "Namaste", "wording can be replaced");

  // limits, tidying, disconnecting
  tg = build({ limits: { perIp: 1, total: 1000 } });
  assert.equal((await call("/start", { purpose: "auth" })).status, 429);
  tg = real;
  await tg.cleanup(30);
  assert.ok((await store.listLogins(5)).length, "recent requests stay");
  await tg.cleanup(-1);
  assert.equal((await store.listLogins(5)).length, 0, "old requests go");
  await tg.forgetUser(stu.id);
  assert.equal(await store.account(6002), null);
  r = await call("/admin", { action: "disconnect" }, { as: owner });
  assert.equal(r.data.ready, false);
  assert.deepEqual((await call("/options")).data, { mode: "plain", bot: null });
  assert.equal(await store.getConfig("bot_token"), "");

  // node servers: other routes keep their body, ours are answered
  let passed = false;
  await nodeHandler(tg)({ url: "/other", method: "POST", headers: {}, [Symbol.asyncIterator]() { throw new Error("body was read"); } }, {}, () => void (passed = true));
  assert.equal(passed, true);
  const sent = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = String(b); } };
  await nodeHandler(tg)({ url: "/api/tg/status", method: "POST", headers: { host: "site.test" }, body: { token: "x", poll: "y" } }, sent);
  assert.deepEqual([sent.statusCode, JSON.parse(sent.body)], [200, { st: "gone" }]);

  // a server without https: polling instead of a webhook
  tg = build({ updates: "polling", origin: "http://localhost:3000" });
  r = await call("/admin", { action: "connect", token: TEST_TOKEN }, { as: owner });
  assert.deepEqual([r.data.ready, r.data.webhook, mock.hook()], [true, "", null]);
  tg = build({ origin: "http://localhost:3000" });
  await call("/admin", { action: "connect", token: TEST_TOKEN }, { as: owner });
  await mock.say(person(325, "Z"), "/start");
  assert.deepEqual([mock.messages(325).length, mock.buttons(325).length], [1, 0], "no buttons to localhost, Telegram refuses them");
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAll();
  console.log("tg-verify: every check passed (in-memory store)");
}
