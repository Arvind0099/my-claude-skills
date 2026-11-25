// Browser side: sign in / create / forgot password (mountTgAuth) and the account card (mountTgLink). No dependencies.
// Restyle through tg.css or by changing the markup here; keep the calls, the states and the one-time rules.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
class Safe {
  constructor(s) {
    this.s = s;
  }
}
export const raw = (s) => new Safe(s);
const out = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(out).join("") : v === false || v == null ? "" : String(v).replace(/[&<>"']/g, (c) => ESC[c]));
export const html = (parts, ...values) => new Safe(parts.reduce((s, p, i) => s + p + (i < values.length ? out(values[i]) : ""), ""));
export const paint = (el, content) => {
  el.innerHTML = out(content);
};
export const $ = (sel, el = document) => el.querySelector(sel);
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}
export async function api(path, body, method) {
  let res, data = null;
  try {
    res = await fetch(path, { method: method || (body ? "POST" : "GET"), headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0);
  }
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(data?.error || `The server answered with an error (${res.status}).`, res.status, data);
  return data;
}
export async function busy(button, work) {
  if (!button || button.disabled) return;
  button.disabled = true;
  button.classList.add("tgv-busy");
  try {
    await work();
  } finally {
    button.disabled = false;
    button.classList.remove("tgv-busy");
  }
}

const KEY = "tgv_request";
const save = (v) => {
  try {
    v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY);
  } catch {}
};
export const clearRequest = () => save(null);
export function savedRequest() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return v && v.until > Date.now() ? v : null;
  } catch {
    return null;
  }
}
const DENIED = {
  number: "That wasn't the number shown here, so the request was stopped.",
  refused: "The request was declined in Telegram.",
  blocked: "That account is blocked.",
  taken: "That Telegram already belongs to another account.",
  unknown: "No account is linked to that Telegram.",
  closed: "New accounts are closed at the moment.",
  link: "That Telegram couldn't be linked. Please try again.",
  tries: "Too many wrong tries."
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const loading = html`<div class="tgv-load"><span class="tgv-spin" aria-hidden="true"></span><span class="tgv-sr">Loading</span></div>`;

export function telegramPanel(host, { base = "/api/tg", purpose, onVerified, onLinked, label = "Open Telegram" }) {
  let stopped = false, timer = 0, ticker = 0, req = null, polling = false, began = 0;
  const wake = () => !document.hidden && req && poll();
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(ticker);
    document.removeEventListener("visibilitychange", wake);
  };
  const problem = (text) => {
    clearTimeout(timer);
    clearInterval(ticker);
    save(null);
    req = null;
    paint(host, html`<div class="tgv-panel"><p class="tgv-err" role="alert">${text}</p><button type="button" class="tgv-btn tgv-primary" data-again>Start again</button></div>`);
    $("[data-again]", host).onclick = begin;
  };
  function draw() {
    paint(host, html`<div class="tgv-panel">
      <ol class="tgv-steps"><li>Open the bot and press <b>Start</b>.</li><li>Tap this number there:</li></ol>
      <div class="tgv-row"><div class="tgv-num" aria-label="Your number is ${req.code}">${String(req.code).split("").map((d) => html`<b aria-hidden="true">${d}</b>`)}</div><div class="tgv-qr" aria-hidden="true"></div></div>
      <a class="tgv-btn tgv-primary" href="${req.url}" target="_blank" rel="noopener">${label} <span class="tgv-at">@${req.bot}</span></a>
      <p class="tgv-st" role="status"><span class="tgv-spin" aria-hidden="true"></span><span data-st>Waiting for you in Telegram</span><span class="tgv-left" data-left></span></p>
    </div>`);
    if (matchMedia("(min-width: 700px)").matches) import("./qr.js").then(({ qrSvg }) => {
      const box = $(".tgv-qr", host);
      if (box && req) paint(box, html`${raw(qrSvg(req.url, { px: 132 }))}<small>Scan with your phone</small>`);
    }).catch(() => {});
    clearInterval(ticker);
    const tick = () => {
      const left = (req?.until - Date.now()) / 1000, el = $("[data-left]", host);
      if (!req || !el) return;
      if (left <= 0) return problem("That took too long, so the request ran out.");
      el.textContent = clock(left);
    };
    tick();
    ticker = setInterval(tick, 1000);
  }
  async function poll() {
    if (stopped || polling || !req) return;
    clearTimeout(timer);
    polling = true;
    try {
      const s = await api(base + "/status", { token: req.token, poll: req.poll });
      if (stopped || !req) return;
      const st = $("[data-st]", host);
      if (s.st === "asked" && st) st.textContent = "Tap the number in Telegram";
      else if (s.st === "join" && st) st.textContent = "Join the channel the bot named, then tap I joined";
      else if (s.st === "phone" && st) st.textContent = "Number matched. Answer the bot's last question";
      else if (s.st === "denied") return problem(DENIED[s.why] || "The request was stopped.");
      else if (s.st === "gone") return problem("This request has run out.");
      else if (s.st === "verified") {
        const keys = { token: req.token, poll: req.poll };
        save({ ...req, until: Date.now() + 25 * 60e3 });
        stop();
        return onVerified?.(keys, s);
      } else if (s.st === "done") {
        save(null);
        stop();
        return purpose === "link" ? onLinked?.() : problem("This was already finished in another tab. Sign in instead.");
      }
    } catch {
    } finally {
      polling = false;
    }
    if (!stopped && req && !document.hidden) timer = setTimeout(poll, Date.now() - began > 120e3 ? 4000 : 2000);
  }
  async function begin() {
    paint(host, loading);
    try {
      const kept = savedRequest();
      if (kept && kept.purpose === purpose) req = kept;
      else {
        const r = await api(base + "/start", { purpose });
        req = { ...r, purpose, until: Date.now() + r.ttl };
        save(req);
      }
      if (stopped) return;
      began = Date.now();
      draw();
      poll();
    } catch (e) {
      if (!stopped) problem(e.message);
    }
  }
  document.addEventListener("visibilitychange", wake);
  begin();
  return { stop };
}

export function mountTgAuth(host, opts) {
  const o = { base: "/api/tg", loginLabel: "Email", loginType: "email", minPassword: 6, note: "", ...opts };
  let options = { mode: "plain", bot: null }, panel = null, keys = null, alive = true;
  const takeJoin = () => {
    const url = new URL(location.href), join = url.searchParams.get("join");
    if (!join) return "";
    url.searchParams.delete("join");
    history.replaceState(history.state, "", url);
    return join;
  };
  const login = html`<label class="tgv-field"><span>${o.loginLabel}</span><input name="login" type="${o.loginType}" autocomplete="username" spellcheck="false" autocapitalize="none" required></label>`;
  const pass = (label, auto, name = "password") => html`<label class="tgv-field"><span>${label}</span><input name="${name}" type="password" autocomplete="${auto}" minlength="${o.minPassword}" required></label>`;
  const verified = (s) => html`<p class="tgv-ok">✓ Verified as <b>${s.name || "you"}</b>${s.username ? html` @${s.username}` : ""}</p>`;
  const check = (d) => (!String(d.login ?? "x").trim() ? `Enter your ${o.loginLabel.toLowerCase()}.` : (d.password || "").length < o.minPassword ? `Use at least ${o.minPassword} characters for the password.` : d.again !== undefined && d.again !== d.password ? "The two passwords don't match." : "");

  function screen(content) {
    if (!alive) return false;
    panel?.stop();
    panel = null;
    paint(host, html`<div class="tgv">${content}</div>`);
    host.querySelectorAll("[data-go]").forEach((b) => {
      b.onclick = () => views[b.dataset.go]();
    });
    return true;
  }
  async function enter(data) {
    clearRequest();
    await o.onSignedIn(data.user || data, data);
  }
  function onSubmit(send, test = check) {
    const form = $("form", host), err = $(".tgv-err", form);
    form.onsubmit = (e) => {
      e.preventDefault();
      err.textContent = "";
      const d = Object.fromEntries(new FormData(form)), wrong = test(d);
      if (wrong) {
        err.textContent = wrong;
        return;
      }
      busy($("[type=submit]", form), async () => {
        try {
          await enter(await send(d));
        } catch (ex) {
          err.textContent = ex.message;
          if (ex.status === 410) setTimeout(() => alive && views.signin(ex.message), 1800);
        }
      });
    };
  }
  const submit = (label) => html`<div class="tgv-err" role="alert"></div><button class="tgv-btn tgv-primary" type="submit">${label}</button>`;
  const go = (view, label) => html`<button type="button" class="tgv-link" data-go="${view}">${label}</button>`;
  const filled = (d) => (!d.login.trim() || !d.password ? `Enter your ${o.loginLabel.toLowerCase()} and password.` : "");

  const views = {
    signin(message = "") {
      clearRequest();
      keys = null;
      screen(html`<form class="tgv-stack" novalidate><h1>Sign in</h1>${login}${pass("Password", "current-password")}${submit("Sign in")}
        ${options.bot ? html`<div class="tgv-or"><span>or</span></div><button class="tgv-btn" type="button" data-go="telegram">Continue with Telegram</button>` : ""}
        <p class="tgv-alt">${options.mode === "closed" ? "" : html`New here? ${go("create", "Create an account")}`} ${options.bot ? go("forgot", "Forgot password?") : ""}</p></form>`);
      $(".tgv-err", host).textContent = typeof message === "string" ? message : "";
      onSubmit((d) => o.signIn(d.login.trim(), d.password), filled);
    },
    create() {
      if (options.mode === "telegram" || !o.signUp) return options.bot ? views.telegram() : views.signin("New accounts are closed at the moment.");
      screen(html`<form class="tgv-stack" novalidate><h1>Create your account</h1>
        ${options.bot ? html`<button class="tgv-btn" type="button" data-go="telegram">Verify with Telegram</button><div class="tgv-or"><span>or</span></div>` : ""}
        ${login}${pass("Password", "new-password")}${submit("Create account")}<p class="tgv-alt">Already have an account? ${go("signin", "Sign in")}</p></form>`);
      onSubmit((d) => o.signUp(d.login.trim(), d.password));
    },
    telegram() {
      const fresh = options.mode !== "closed";
      screen(html`<div class="tgv-stack"><div><h1>${fresh ? "Continue with Telegram" : "Sign in with Telegram"}</h1><p class="tgv-sub">${fresh ? `New here? This verifies you, then you choose your own ${o.loginLabel.toLowerCase()} and password.` : "For accounts that have Telegram linked."}</p></div><div data-panel></div>
        <p class="tgv-note">Kept with your account: your Telegram name, username, ID and language, the time, device, IP address and rough location you verified from, and your number if you share it.</p>
        <p class="tgv-alt">${go("signin", "Use your password")}</p></div>`);
      panel = telegramPanel($("[data-panel]", host), { base: o.base, purpose: "auth", onVerified: (k, s) => {
        keys = k;
        s.known ? signIn(s) : views.details(s);
      } });
    },
    forgot() {
      screen(html`<div class="tgv-stack"><div><h1>Forgot password</h1><p class="tgv-sub">Prove it's you in the Telegram linked to your account, then set a new one.</p></div><div data-panel></div><p class="tgv-alt">${go("signin", "Back to sign in")}</p></div>`);
      panel = telegramPanel($("[data-panel]", host), { base: o.base, purpose: "reset", onVerified: (k, s) => {
        keys = k;
        views.reset(s);
      } });
    },
    details(s = {}) {
      screen(html`<form class="tgv-stack" novalidate>${verified(s)}<div><h1>Choose your login</h1><p class="tgv-sub">You'll use these from now on.</p></div>
        <label class="tgv-field"><span>Your name</span><input name="name" autocomplete="name" maxlength="60" value="${s.name || ""}"></label>${login}${pass("Password", "new-password")}${pass("Password again", "new-password", "again")}${submit("Create account")}
        <p class="tgv-alt">Already have an account? <button type="button" class="tgv-link" data-existing>Link it instead</button></p></form>`);
      $("[data-existing]", host).onclick = () => views.existing(s);
      onSubmit((d) => api(o.base + "/finish", { ...keys, name: d.name, login: d.login.trim(), password: d.password }));
    },
    existing(s = {}) {
      screen(html`<form class="tgv-stack" novalidate>${verified(s)}<div><h1>Link your account</h1><p class="tgv-sub">Sign in once with your current password. Telegram is linked to that account.</p></div>${login}${pass("Password", "current-password")}${submit("Sign in and link")}
        <p class="tgv-alt">No account yet? <button type="button" class="tgv-link" data-fresh>Create one</button></p></form>`);
      $("[data-fresh]", host).onclick = () => views.details(s);
      onSubmit((d) => api(o.base + "/finish", { ...keys, existing: true, login: d.login.trim(), password: d.password }), filled);
    },
    reset(s = {}) {
      screen(html`<form class="tgv-stack" novalidate><p class="tgv-ok">✓ It's you, <b>${s.login || s.name}</b></p><h1>Set a new password</h1>${pass("New password", "new-password")}${pass("New password again", "new-password", "again")}${submit("Save and sign in")}</form>`);
      onSubmit((d) => api(o.base + "/finish", { ...keys, password: d.password }));
    }
  };
  async function signIn(s, ask) {
    const run = async () => {
      try {
        await enter(await api(o.base + "/finish", keys));
      } catch (e) {
        if (alive) views.signin(e.message);
      }
    };
    screen(html`<div class="tgv-stack"><p class="tgv-ok">✓ ${s.name || "Verified"}</p><h1>${ask ? "Sign in?" : "Signing you in"}</h1>${s.login ? html`<p class="tgv-sub">Account <b>${s.login}</b></p>` : ""}${ask ? html`<button class="tgv-btn tgv-primary" data-in>Sign in</button><p class="tgv-alt">${go("signin", "Not you? Go back")}</p>` : loading}</div>`);
    if (!ask) return run();
    $("[data-in]", host).onclick = (e) => busy(e.currentTarget, run);
  }
  (async () => {
    screen(loading);
    options = await api(o.base + "/options").catch(() => options);
    if (!alive) return;
    const join = takeJoin();
    if (join) {
      keys = { fin: join };
      try {
        const s = await api(o.base + "/finish", { fin: join, check: true });
        if (!alive) return;
        return s.need === "login" ? signIn(s, true) : s.need === "reset" ? views.reset(s) : views.details(s);
      } catch (e) {
        return alive && views.signin(e.message);
      }
    }
    const kept = options.bot && savedRequest();
    if (kept?.purpose === "auth") return views.telegram();
    if (kept?.purpose === "reset") return views.forgot();
    views.signin(o.note);
  })();
  return { show: (view) => views[view]?.(), stop() {
    alive = false;
    panel?.stop();
  } };
}

export function mountTgLink(host, { base = "/api/tg", onChange } = {}) {
  let panel = null, alive = true;
  async function draw() {
    panel?.stop();
    panel = null;
    let me;
    try {
      me = await api(base + "/me");
      if (!alive) return;
    } catch (e) {
      return alive && paint(host, html`<div class="tgv"><p class="tgv-err">${e.message}</p></div>`);
    }
    const t = me.telegram;
    paint(host, html`<div class="tgv tgv-stack"><h2>Telegram</h2><p class="tgv-sub">${t ? html`Linked to <b>${t.name || "your Telegram"}</b>${t.username ? html` @${t.username}` : ""}. You can sign in with it and reset your password there.` : "Link Telegram to sign in without a password and to reset a forgotten one."}</p>${me.bot ? html`<button type="button" class="tgv-btn" data-link>${t ? "Link a different Telegram" : "Link Telegram"}</button>` : html`<p class="tgv-note">Telegram isn't set up on this site yet.</p>`}</div>`);
    const b = $("[data-link]", host);
    if (b) b.onclick = () => {
      clearRequest();
      paint(host, html`<div class="tgv tgv-stack"><h2>Telegram</h2><div data-panel></div><button type="button" class="tgv-link" data-cancel>Cancel</button></div>`);
      $("[data-cancel]", host).onclick = () => {
        clearRequest();
        draw();
      };
      panel = telegramPanel($("[data-panel]", host), { base, purpose: "link", onLinked: async () => {
        await draw();
        onChange?.();
      } });
    };
  }
  draw();
  return { refresh: draw, stop() {
    alive = false;
    panel?.stop();
  } };
}
