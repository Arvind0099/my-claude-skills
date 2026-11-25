// Supabase through its REST API, no SDK. supabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY })
// The key is the server-side secret/service key. It must come from a secret and never reach the browser.
import { DuplicateError } from "./tg-verify.mjs";

export function supabaseStore({ url, key, prefix = "", fetch: f = (...a) => fetch(...a) }) {
  const root = url.replace(/\/$/, "") + "/rest/v1/";
  const LOGINS = prefix + "tg_logins", ACCOUNTS = prefix + "telegram_accounts", CONFIG = prefix + "tg_config";
  const v = encodeURIComponent;
  async function call(method, table, query = "", body, prefer) {
    const headers = { apikey: key, "content-type": "application/json" };
    if (key.startsWith("eyJ")) headers.authorization = "Bearer " + key;
    if (prefer) headers.prefer = prefer;
    const res = await f(root + table + query, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      const e = new Error(`Supabase ${method} ${table} failed (${res.status}): ${text.slice(0, 300)}`);
      e.missing = /PGRST205|42P01/.test(text);
      e.duplicate = res.status === 409 || /23505/.test(text);
      throw e;
    }
    return { rows: text ? JSON.parse(text) : [], total: Number(res.headers.get("content-range")?.split("/")[1]) || 0 };
  }
  const fix = (r) => (r ? { ...r, ...(r.tg_id != null ? { tg_id: Number(r.tg_id) } : {}), ...(r.user_id != null ? { user_id: String(r.user_id) } : {}) } : null);
  const list = async (table, query) => (await call("GET", table, query)).rows.map(fix);
  const one = async (table, query) => (await list(table, query))[0] || null;

  return {
    async ready() {
      try {
        await Promise.all([list(LOGINS, "?select=id&limit=1"), list(ACCOUNTS, "?select=tg_id&limit=1"), list(CONFIG, "?select=key&limit=1")]);
        return true;
      } catch (e) {
        if (e.missing) return false;
        throw e;
      }
    },
    getConfig: async (k) => (await one(CONFIG, `?key=eq.${v(k)}&select=value`))?.value || "",
    setConfig: (k, value) => call("POST", CONFIG, "?on_conflict=key", { key: k, value }, "resolution=merge-duplicates,return=minimal"),
    addLogin: (row) => call("POST", LOGINS, "", row, "return=minimal"),
    loginByToken: (h) => one(LOGINS, `?token_hash=eq.${v(h)}&select=*`),
    loginByFin: (h) => one(LOGINS, `?fin_hash=eq.${v(h)}&select=*`),
    loginById: (id) => one(LOGINS, `?id=eq.${v(id)}&select=*`),
    openLogin: (tgId, status) => one(LOGINS, `?tg_id=eq.${v(tgId)}&status=eq.${v(status)}&expires_at=gt.${v(new Date().toISOString())}&select=*&order=created_at.desc&limit=1`),
    moveLogin: async (id, from, patch) => fix((await call("PATCH", LOGINS, `?id=eq.${v(id)}&status=in.(${from.join(",")})`, patch, "return=representation")).rows[0]),
    countLogins: async ({ ip, since }) => (await call("GET", LOGINS, `?select=id&created_at=gte.${v(since)}${ip ? `&ip=eq.${v(ip)}` : ""}&limit=1`, undefined, "count=exact")).total,
    listLogins: (n) => list(LOGINS, `?select=*&order=created_at.desc&limit=${n}`),
    deleteLogins: (before) => call("DELETE", LOGINS, `?created_at=lt.${v(before)}`, undefined, "return=minimal"),
    account: (tgId) => one(ACCOUNTS, `?tg_id=eq.${v(tgId)}&select=*`),
    accountOf: (userId) => one(ACCOUNTS, `?user_id=eq.${v(userId)}&select=*`),
    accountsOf: async (ids) => (ids.length ? list(ACCOUNTS, `?user_id=in.(${ids.map(v).join(",")})&select=*`) : []),
    async addAccount(row) {
      try {
        await call("POST", ACCOUNTS, "", row, "return=minimal");
      } catch (e) {
        throw e.duplicate ? new DuplicateError("already linked") : e;
      }
    },
    updateAccount: (tgId, patch) => call("PATCH", ACCOUNTS, `?tg_id=eq.${v(tgId)}`, patch, "return=minimal"),
    removeAccount: (userId) => call("DELETE", ACCOUNTS, `?user_id=eq.${v(userId)}`, undefined, "return=minimal"),
    async listAccounts({ search, page, size }) {
      const q = search.replace(/[%*,()"\\@+]/g, "").trim();
      const like = v(q);
      const or = q ? `&or=(username.ilike.*${like}*,first_name.ilike.*${like}*,last_name.ilike.*${like}*,phone.ilike.*${like}*${/^\d{3,20}$/.test(q) ? `,tg_id.eq.${q}` : ""})` : "";
      const { rows, total } = await call("GET", ACCOUNTS, `?select=*&order=verified_at.desc${or}&limit=${size}&offset=${(page - 1) * size}`, undefined, "count=exact");
      return { rows: rows.map(fix), total };
    }
  };
}
