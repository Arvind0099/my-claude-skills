// Admin page: connect the bot, choose the rules, see who verified. mountTgAdmin(host, { base })
import { $, api, busy, html, paint } from "./tg-client.js";

const STATE = { new: ["", "Not opened"], asked: ["warn", "Asked for the number"], join: ["warn", "Asked to join"], phone: ["warn", "Asked for mobile"], verified: ["", "Verified, not finished"], done: ["ok", "Finished"], denied: ["bad", "Stopped"] };
const WHY = { number: "wrong number", refused: "tapped Not me", blocked: "account blocked", taken: "Telegram in use", unknown: "no account", closed: "sign-up closed", link: "couldn't be linked", tries: "too many wrong tries" };
const FOR = { auth: "Sign up or in", reset: "Password reset", link: "Link" };
const full = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(" ");
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

export function mountTgAdmin(host, { base = "/api/tg" } = {}) {
  const at = base + "/admin";
  let d, q = "", page = 1, seq = 0, timer = 0;
  paint(host, html`<div class="tgv tgv-admin"><div class="tgv-cols"><section class="tgv-card" data-bot></section><section class="tgv-card" data-rules></section></div><p class="tgv-say" role="status" data-say></p>
    <section class="tgv-card"><h2>Verified people</h2><div class="tgv-bar"><input type="search" data-q placeholder="Name, username, mobile or Telegram ID" aria-label="Search"><button type="button" class="tgv-btn tgv-sm" data-csv>Export CSV</button></div><div data-people></div></section>
    <section class="tgv-card"><h2>Latest requests</h2><p class="tgv-note">Kept for 30 days.</p><div data-requests></div></section></div>`);
  const root = $(".tgv-admin", host);
  const tell = (text, bad) => {
    const el = $("[data-say]", root);
    el.textContent = text;
    el.classList.toggle("tgv-err", !!bad);
  };

  function drawBot() {
    const i = d.info, wrong = i && !i.failed && d.webhook && i.url !== d.webhook;
    const [tone, label, text] = !d.tables ? ["bad", "Database not ready", "Create the tables with the schema file, then reload."] : !d.ready ? ["warn", d.source === "unreadable" ? "Token can't be read" : "Not connected", d.source === "unreadable" ? "The stored token was sealed with another secret. Paste it again." : "Paste the bot token from @BotFather and connect."] : i?.failed ? ["bad", "Telegram refused", i.failed] : wrong ? ["bad", "Pointed elsewhere", `Telegram sends this bot's messages to ${i.url || "nowhere"}. Press Connect again.`] : i?.error ? ["warn", "Messages are stuck", `${i.pending} waiting: ${i.error}`] : ["ok", "Working", "Messages are arriving."];
    paint($("[data-bot]", root), html`<div class="tgv-bar"><h2>Bot</h2><span class="tgv-tag ${tone}">${label}</span></div>${d.bot ? html`<p><b>${d.bot.name}</b> <a class="tgv-link" href="https://t.me/${d.bot.username}" target="_blank" rel="noopener">@${d.bot.username}</a></p>` : ""}<p class="tgv-sub">${text}</p>${d.webhook ? html`<code class="tgv-code">${d.webhook}</code>` : ""}
      ${!d.owner ? html`<p class="tgv-note">Only an owner can change the bot.</p>` : html`<form class="tgv-stack" data-connect>${d.source === "secret" ? html`<p class="tgv-note">The token comes from the server's secret.</p>` : html`<label class="tgv-field"><span>${d.bot ? "New token" : "Bot token"}</span><input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${d.bot ? "Leave empty to keep the current one" : "123456789:ABC…"}"><small>${d.canStore ? "Stored encrypted. It is never shown again." : "The server has no secret, so the token can't be stored."}</small></label>`}<div class="tgv-bar"><button class="tgv-btn tgv-primary tgv-sm" type="submit">${d.bot ? "Connect again" : "Connect"}</button>${d.bot ? html`<button class="tgv-btn tgv-sm tgv-bad" type="button" data-off>Disconnect</button>` : ""}</div></form>`}`);
    const form = $("[data-connect]", root);
    if (!form) return;
    const connect = async (move) => {
      try {
        d = await api(at, { action: "connect", token: form.elements.token?.value.trim(), move });
        draw();
        tell("Connected to @" + d.bot.username);
      } catch (e) {
        if (!e.data?.elsewhere) return tell(e.message, true);
        if (confirm(`@${e.data.username} already works for ${e.data.elsewhere}. If you move it here, it stops answering there. Move it?`)) await connect(true);
      }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      busy($("[type=submit]", form), () => connect(false));
    };
    const off = $("[data-off]", form);
    if (off) off.onclick = () => confirm("Disconnect the bot? Telegram sign-up, sign-in and password reset stop. Accounts keep working with their passwords.") && busy(off, async () => {
      try {
        d = await api(at, { action: "disconnect" });
        draw();
        tell("Bot disconnected");
      } catch (e) {
        tell(e.message, true);
      }
    });
  }
  function drawRules() {
    const s = d.settings, dis = d.owner ? "" : "disabled";
    paint($("[data-rules]", root), html`<h2>Sign-up</h2><form class="tgv-stack" data-settings>
      <label class="tgv-field"><span>Who can create an account</span><select name="mode" ${dis}><option value="telegram">Only people verified on Telegram</option><option value="both">Telegram, or without verification</option><option value="closed">Nobody for now</option></select><small>${d.ready ? "Existing accounts keep working either way." : "Until the bot is connected, the normal sign-up stays open."}</small></label>
      <label class="tgv-field"><span>Mobile number</span><select name="phone" ${dis}><option value="ask">Ask, they may skip</option><option value="required">Required</option><option value="off">Don't ask</option></select><small>Telegram only reveals a number when the person taps Share.</small></label>
      <label class="tgv-field"><span>Must join a channel first</span><input name="gate" value="${s.gate ? (s.gate.url ? "@" + s.gate.url.split("/").pop() : s.gate.chat) : ""}" placeholder="@yourchannel, or empty for none" autocomplete="off" spellcheck="false" ${dis}><small>${s.gate ? "Now: " + s.gate.title : "Make the bot an admin of the channel first."}</small></label>
      <label class="tgv-check"><input type="checkbox" name="notify" ${s.notify ? "checked" : ""} ${dis}> Message staff on Telegram about each new account</label>
      ${d.owner ? html`<button class="tgv-btn tgv-primary tgv-sm" type="submit">Save rules</button>` : ""}</form>`);
    const form = $("[data-settings]", root), f = form.elements;
    f.mode.value = s.mode;
    f.phone.value = s.phone;
    const before = f.gate.value;
    form.onsubmit = (e) => {
      e.preventDefault();
      busy($("[type=submit]", form), async () => {
        try {
          d = await api(at, { action: "settings", mode: f.mode.value, phone: f.phone.value, notify: f.notify.checked, ...(f.gate.value !== before ? { gate: f.gate.value } : {}) });
          draw();
          tell("Rules saved");
        } catch (ex) {
          tell(ex.message, true);
        }
      });
    };
  }
  const draw = () => {
    drawBot();
    drawRules();
  };
  async function people() {
    const box = $("[data-people]", root), mine = ++seq;
    if (!d.tables) return paint(box, html`<p class="tgv-note">Nothing yet.</p>`);
    try {
      const r = await api(`${at}/people?page=${page}&q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      const pages = Math.max(1, Math.ceil(r.total / r.size));
      paint(box, !r.rows.length ? html`<p class="tgv-note">${q ? "Nobody matches." : "People appear here once they verify through the bot."}</p>` : html`<div class="tgv-scroll"><table class="tgv-table"><thead><tr><th>Telegram</th><th>Account</th><th>Mobile</th><th>Telegram ID</th><th>From</th><th>Verified</th><th></th></tr></thead><tbody>${r.rows.map((p) => html`<tr><td><div><b>${full(p) || "No name"}</b>${p.is_premium ? html` <span class="tgv-tag">Premium</span>` : ""}<small>${p.username ? html`<a class="tgv-link" href="https://t.me/${p.username}" target="_blank" rel="noopener">@${p.username}</a>` : "No username"}</small></div></td><td data-l="Account"><div>${p.account ? p.account.login : "Deleted"}</div></td><td data-l="Mobile"><div>${p.phone || "Not shared"}</div></td><td data-l="Telegram ID"><div>${p.tg_id}</div></td><td data-l="From"><div>${[p.city, p.country].filter(Boolean).join(", ") || "Unknown"}<small>${p.device || ""}</small></div></td><td data-l="Verified"><div>${when(p.verified_at)}<small>${p.linked_via === "signup" ? "New account" : "Linked later"}</small></div></td><td>${d.owner ? html`<button type="button" class="tgv-link" data-unlink="${p.user_id}" data-who="${full(p) || p.tg_id}">Unlink</button>` : ""}</td></tr>`)}</tbody></table></div>${pages > 1 ? html`<div class="tgv-bar"><button type="button" class="tgv-btn tgv-sm" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${page} of ${pages}</span><button type="button" class="tgv-btn tgv-sm" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Next</button></div>` : ""}`);
    } catch (e) {
      if (mine === seq) paint(box, html`<p class="tgv-err">${e.message}</p>`);
    }
  }
  async function requests() {
    const box = $("[data-requests]", root);
    if (!d.tables) return paint(box, html``);
    try {
      const rows = await api(at + "/requests");
      paint(box, !rows.length ? html`<p class="tgv-note">No requests yet.</p>` : html`<div class="tgv-scroll"><table class="tgv-table"><thead><tr><th>When</th><th>For</th><th>Person</th><th>Result</th><th>From</th><th>IP</th></tr></thead><tbody>${rows.map((r) => {
        const out = !["done", "denied"].includes(r.status) && new Date(r.expires_at) < Date.now(), [tone, label] = STATE[r.status] || ["", r.status];
        return html`<tr><td><div>${when(r.created_at)}</div></td><td data-l="For"><div>${FOR[r.purpose]}</div></td><td data-l="Person"><div>${r.tg ? html`${full(r.tg) || "No name"}${r.tg.username ? " @" + r.tg.username : ""}` : "Nobody"}</div></td><td data-l="Result"><div><span class="tgv-tag ${out ? "" : tone}">${out ? "Ran out" : label}</span>${r.why ? html`<small>${WHY[r.why] || r.why}</small>` : ""}</div></td><td data-l="From"><div>${[r.city, r.country].filter(Boolean).join(", ")}<small>${r.device || ""}</small></div></td><td data-l="IP"><div>${r.ip || ""}</div></td></tr>`;
      })}</tbody></table></div>`);
    } catch (e) {
      paint(box, html`<p class="tgv-err">${e.message}</p>`);
    }
  }
  function csv(rows) {
    const cell = (v) => {
      const s = String(v ?? "");
      return '"' + (/^[=+\-@\t\r]/.test(s) && !/^\+\d+$/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
    };
    const head = ["Name", "Username", "Telegram ID", "Mobile", "Account", "Language", "Premium", "City", "Country", "Device", "IP", "How", "Verified", "Last seen"];
    const lines = rows.map((p) => [full(p), p.username, p.tg_id, p.phone, p.account?.login, p.language_code, p.is_premium ? "Yes" : "No", p.city, p.country, p.device, p.ip, p.linked_via === "signup" ? "New account" : "Linked later", when(p.verified_at), when(p.last_seen_at)]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv" }));
    a.download = "telegram.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-page], [data-unlink], [data-csv]");
    if (!b) return;
    if (b.dataset.page) {
      page = +b.dataset.page;
      return people();
    }
    if (b.dataset.unlink) return confirm(`Unlink the Telegram of ${b.dataset.who}? They can then only sign in with their password.`) && busy(b, async () => {
      try {
        await api(`${at}/people/${encodeURIComponent(b.dataset.unlink)}`, null, "DELETE");
        await people();
        tell("Unlinked");
      } catch (ex) {
        tell(ex.message, true);
      }
    });
    busy(b, async () => {
      try {
        const rows = [];
        for (let n = 1; n <= 50; n++) {
          const r = await api(`${at}/people?page=${n}&size=100&q=${encodeURIComponent(q)}`);
          rows.push(...r.rows);
          if (!r.rows.length || rows.length >= r.total) break;
        }
        csv(rows);
        tell(rows.length + " exported");
      } catch (ex) {
        tell(ex.message, true);
      }
    });
  });
  $("[data-q]", root).addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      q = e.target.value.trim();
      page = 1;
      people();
    }, 220);
  });
  (async () => {
    try {
      d = await api(at);
    } catch (e) {
      return paint(root, html`<p class="tgv-err">${e.message}</p>`);
    }
    draw();
    people();
    requests();
  })();
  return { stop: () => clearTimeout(timer) };
}
