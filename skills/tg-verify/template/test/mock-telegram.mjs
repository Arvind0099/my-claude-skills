// A stand-in for api.telegram.org plus pretend people with phones, so everything can be tried without a real bot.
//   node mock-telegram.mjs 8799        then run the site with config.apiBase = http://127.0.0.1:8799
// Connect the bot with TEST_TOKEN. Drive a person over HTTP:
//   POST /__open  {"user":{"id":5551,"first_name":"Aman"},"url":"https://t.me/…?start=j_…"}   press Start on the deep link
//   POST /__tap   {"user":{"id":5551},"label":"42"}        press a button under the last message
//   POST /__share {"user":{"id":5551},"phone":"910000012345"}   share own number (add "contactId" for somebody else's)
//   POST /__say   {"user":{"id":5551},"text":"Skip"}       send a text
//   POST /__join  {"user":{"id":5551}}                     join @testchannel
//   GET  /__chat?id=5551                                   what that person sees      GET /__calls   every Bot API call
import http from "node:http";
import { pathToFileURL } from "node:url";

export const TEST_TOKEN = "123456789:TEST_TOKEN_FOR_THE_LOCAL_MOCK_ONLY";
export const BOT = { id: 777, is_bot: true, username: "tg_verify_test_bot", first_name: "Test Bot" };

export function createMockTelegram({ token = TEST_TOKEN, deliver } = {}) {
  const calls = [], chats = new Map(), members = new Set(), about = {};
  let hook = null, ids = 100, updates = 0;
  const chat = (id) => {
    if (!chats.has(Number(id))) chats.set(Number(id), { messages: [], keyboard: null });
    return chats.get(Number(id));
  };
  function run(method, body, key) {
    calls.push({ method, body });
    const ok = (result) => ({ ok: true, result }), bad = (error_code, description) => ({ ok: false, error_code, description });
    if (key !== token) return bad(401, "Unauthorized");
    const mark = body.reply_markup || {};
    switch (method) {
      case "getMe": return ok(BOT);
      case "setWebhook": hook = body; return ok(true);
      case "deleteWebhook": hook = null; return ok(true);
      case "getWebhookInfo": return ok({ url: hook?.url || "", pending_update_count: 0 });
      case "getMyDescription": return ok({ description: about.description || "" });
      case "getMyShortDescription": return ok({ short_description: about.short_description || "" });
      case "setMyDescription": case "setMyShortDescription": Object.assign(about, body); return ok(true);
      case "getChat": return body.chat_id === "@testchannel" ? ok({ id: -1001, title: "Test Channel", username: "testchannel" }) : bad(400, "chat not found");
      case "getChatMember": return ok({ status: body.user_id === BOT.id ? "administrator" : members.has(Number(body.user_id)) ? "member" : "left" });
      case "sendMessage": {
        const c = chat(body.chat_id), m = { id: ++ids, text: body.text, buttons: mark.inline_keyboard || [] };
        c.messages.push(m);
        if (mark.keyboard) c.keyboard = mark.keyboard;
        if (mark.remove_keyboard) c.keyboard = null;
        return ok({ message_id: m.id, chat: { id: body.chat_id } });
      }
      case "editMessageText": {
        const m = chat(body.chat_id).messages.find((x) => x.id === body.message_id);
        if (!m) return bad(400, "message to edit not found");
        Object.assign(m, { text: body.text, buttons: mark.inline_keyboard || [] });
        return ok(true);
      }
      default: return ok(true);
    }
  }
  const push = async (update, secret = hook?.secret_token || "") => {
    const body = JSON.stringify({ update_id: ++updates, ...update }), headers = { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret };
    if (deliver) return deliver(body, headers);
    if (!hook) throw new Error("no webhook set: connect the bot first");
    return fetch(hook.url, { method: "POST", headers, body });
  };
  const privately = (u) => ({ id: u.id, type: "private" });
  const say = (u, text) => push({ message: { message_id: ++ids, from: { is_bot: false, ...u }, chat: privately(u), text } });
  const press = (u, data, message) => push({ callback_query: { id: "q" + ++ids, from: { is_bot: false, ...u }, message: { message_id: message, chat: privately(u) }, data } });
  return {
    calls, push, say, press, hook: () => hook,
    messages: (id) => chat(id).messages,
    keyboard: (id) => chat(id).keyboard,
    last: (id) => chat(id).messages.at(-1),
    buttons: (id) => (chat(id).messages.at(-1)?.buttons || []).flat(),
    join: (id) => members.add(Number(id)),
    open: (u, url) => say(u, "/start " + new URL(url).searchParams.get("start")),
    async tap(u, label) {
      for (const m of [...chat(u.id).messages].reverse()) {
        const b = m.buttons.flat().find((x) => x.text === String(label));
        if (b?.callback_data) return press(u, b.callback_data, m.id);
        if (b) return b.url;
      }
      throw new Error(`no button "${label}"`);
    },
    share: (u, phone, contactId = u.id) => push({ message: { message_id: ++ids, from: { is_bot: false, ...u }, chat: privately(u), contact: { user_id: contactId, phone_number: phone } } }),
    // Use as config.fetch to skip the network altogether.
    async fetch(url, init) {
      const m = String(url).match(/\/bot([^/]+)\/(\w+)$/), out = run(m[2], JSON.parse(init?.body || "{}"), m[1]);
      return new Response(JSON.stringify(out), { status: out.ok ? 200 : out.error_code });
    }
  };
}

export function mockRoutes(mock) {
  return async (req, res, url, body) => {
    const send = (data, status = 200) => {
      res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(data ?? null));
      return true;
    };
    const b = () => JSON.parse(body || "{}");
    if (/^\/bot[^/]+\/\w+$/.test(url.pathname)) {
      const r = await mock.fetch(url.pathname, { body });
      return send(await r.json(), r.status);
    }
    if (url.pathname === "/__calls") return send(mock.calls);
    if (url.pathname === "/__chat") return send({ messages: mock.messages(url.searchParams.get("id")), keyboard: mock.keyboard(url.searchParams.get("id")) });
    const act = url.pathname.match(/^\/__(open|tap|share|say|join)$/)?.[1];
    if (!act) return false;
    const { user, url: link, label, phone, contactId, text } = b();
    try {
      const r = act === "open" ? await mock.open(user, link) : act === "tap" ? await mock.tap(user, label) : act === "share" ? await mock.share(user, phone, contactId) : act === "say" ? await mock.say(user, text) : mock.join(user.id);
      return send({ ok: true, status: r?.status, opened: typeof r === "string" ? r : undefined });
    } catch (e) {
      return send({ ok: false, error: e.message }, 400);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]) || 8799, mock = createMockTelegram(), routes = mockRoutes(mock);
  http.createServer(async (req, res) => {
    let body = "";
    for await (const p of req) body += p;
    if (!await routes(req, res, new URL(req.url, "http://x"), body)) res.writeHead(404).end();
  }).listen(port, "127.0.0.1", () => console.log(`mock Telegram on http://127.0.0.1:${port}  token ${TEST_TOKEN}`));
}
