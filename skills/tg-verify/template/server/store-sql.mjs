// SQL databases. d1Store(env.DB) for Cloudflare D1, pgStore(pool) for Postgres (pg, Neon, Hyperdrive),
// sqlStore({ dialect, run }) for anything else: run(sql, params) must return the rows as an array of objects.
import { DuplicateError } from "./tg-verify.mjs";

export const d1Store = (db, opts) => sqlStore({ dialect: "sqlite", run: async (sql, params) => (await db.prepare(sql).bind(...params).all()).results || [], ...opts });
export const pgStore = (pool, opts) => sqlStore({ dialect: "postgres", run: async (sql, params) => (await pool.query(sql, params)).rows, ...opts });

export function sqlStore({ dialect, run, prefix = "" }) {
  const pg = dialect === "postgres";
  const T = { config: prefix + "tg_config", logins: prefix + "tg_logins", accounts: prefix + "telegram_accounts" };
  const value = (v) => (v === undefined ? null : !pg && typeof v === "boolean" ? Number(v) : v);
  const iso = (v) => (v instanceof Date ? v.toISOString() : v);
  const fix = (r) => {
    if (!r) return null;
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k] = k === "tg_id" ? (v == null ? null : Number(v)) : k === "is_premium" ? !!v : k === "user_id" && v != null ? String(v) : iso(v);
    return out;
  };
  // `?` marks become $1, $2… for Postgres, so every query below is written once.
  const query = async (sql, params = []) => {
    let n = 0;
    return (await run(pg ? sql.replace(/\?/g, () => "$" + ++n) : sql, params.map(value))).map(fix);
  };
  const one = async (sql, params) => (await query(sql, params))[0] || null;
  const insert = (table, row) => {
    const keys = Object.keys(row);
    return query(`insert into ${table} (${keys.join(", ")}) values (${keys.map(() => "?").join(", ")})`, keys.map((k) => row[k]));
  };
  const set = (patch) => Object.keys(patch).map((k) => `${k} = ?`).join(", ");
  const marks = (list) => list.map(() => "?").join(", ");
  const missing = (e) => /no such table|does not exist|42P01/i.test(String(e?.code) + " " + String(e?.message));
  const duplicate = (e) => /unique constraint|duplicate key|23505|SQLITE_CONSTRAINT/i.test(String(e?.code) + " " + String(e?.message));

  return {
    async ready() {
      try {
        await query(`select 1 as ok from ${T.logins} limit 1`);
        await query(`select 1 as ok from ${T.accounts} limit 1`);
        await query(`select 1 as ok from ${T.config} limit 1`);
        return true;
      } catch (e) {
        if (missing(e)) return false;
        throw e;
      }
    },
    getConfig: async (k) => (await one(`select value from ${T.config} where key = ?`, [k]))?.value || "",
    setConfig: (k, v) => query(`insert into ${T.config} (key, value) values (?, ?) on conflict (key) do update set value = excluded.value`, [k, v]),
    addLogin: (row) => insert(T.logins, row),
    loginByToken: (h) => one(`select * from ${T.logins} where token_hash = ?`, [h]),
    loginByFin: (h) => one(`select * from ${T.logins} where fin_hash = ?`, [h]),
    loginById: (id) => one(`select * from ${T.logins} where id = ?`, [id]),
    openLogin: (tgId, status) => one(`select * from ${T.logins} where tg_id = ? and status = ? and expires_at > ? order by created_at desc limit 1`, [tgId, status, new Date().toISOString()]),
    moveLogin: (id, from, patch) => one(`update ${T.logins} set ${set(patch)} where id = ? and status in (${marks(from)}) returning *`, [...Object.values(patch), id, ...from]),
    countLogins: async ({ ip, since }) => Number((await one(`select count(*) as n from ${T.logins} where created_at >= ?${ip ? " and ip = ?" : ""}`, ip ? [since, ip] : [since])).n),
    listLogins: (n) => query(`select * from ${T.logins} order by created_at desc limit ?`, [n]),
    deleteLogins: (before) => query(`delete from ${T.logins} where created_at < ?`, [before]),
    account: (tgId) => one(`select * from ${T.accounts} where tg_id = ?`, [tgId]),
    accountOf: (userId) => one(`select * from ${T.accounts} where user_id = ?`, [userId]),
    accountsOf: async (ids) => (ids.length ? query(`select * from ${T.accounts} where user_id in (${marks(ids)})`, ids) : []),
    async addAccount(row) {
      try {
        await insert(T.accounts, row);
      } catch (e) {
        throw duplicate(e) ? new DuplicateError("already linked") : e;
      }
    },
    updateAccount: (tgId, patch) => query(`update ${T.accounts} set ${set(patch)} where tg_id = ?`, [...Object.values(patch), tgId]),
    removeAccount: (userId) => query(`delete from ${T.accounts} where user_id = ?`, [userId]),
    async listAccounts({ search, page, size }) {
      const q = search.trim().toLowerCase().replace(/^[@+]/, "").replace(/[%_\\]/g, "");
      const like = `%${q}%`;
      const cond = q ? ` where lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) like ? or lower(coalesce(username, '')) like ? or coalesce(phone, '') like ? or cast(tg_id as text) like ?` : "";
      const params = q ? [like, like, like, like] : [];
      const total = Number((await one(`select count(*) as n from ${T.accounts}${cond}`, params)).n);
      return { total, rows: await query(`select * from ${T.accounts}${cond} order by verified_at desc limit ? offset ?`, [...params, size, (page - 1) * size]) };
    }
  };
}
