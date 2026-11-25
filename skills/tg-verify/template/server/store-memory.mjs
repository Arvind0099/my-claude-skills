// Keeps everything in memory. For tests and the demo only: a restart forgets it all.
import { DuplicateError } from "./tg-verify.mjs";

export function memoryStore() {
  const config = new Map(), logins = [], accounts = [];
  const copy = (r) => (r ? { ...r } : null);
  return {
    data: { config, logins, accounts },
    ready: async () => true,
    getConfig: async (k) => config.get(k) || "",
    setConfig: async (k, v) => void config.set(k, v),
    addLogin: async (row) => void logins.push({ why: null, tg_id: null, tg: null, phone: null, fin_hash: null, verified_at: null, done_at: null, ...row }),
    loginByToken: async (h) => copy(logins.find((r) => r.token_hash === h)),
    loginByFin: async (h) => copy(logins.find((r) => r.fin_hash === h)),
    loginById: async (id) => copy(logins.find((r) => r.id === id)),
    openLogin: async (tgId, status) => copy(logins.filter((r) => r.tg_id === tgId && r.status === status && r.expires_at > new Date().toISOString()).pop()),
    async moveLogin(id, from, patch) {
      const row = logins.find((r) => r.id === id && from.includes(r.status));
      return row ? copy(Object.assign(row, patch)) : null;
    },
    countLogins: async ({ ip, since }) => logins.filter((r) => r.created_at >= since && (!ip || r.ip === ip)).length,
    listLogins: async (n) => logins.slice(-n).reverse().map(copy),
    async deleteLogins(before) {
      for (let i = logins.length - 1; i >= 0; i--) if (logins[i].created_at < before) logins.splice(i, 1);
    },
    account: async (tgId) => copy(accounts.find((a) => a.tg_id === tgId)),
    accountOf: async (userId) => copy(accounts.find((a) => a.user_id === userId)),
    accountsOf: async (ids) => accounts.filter((a) => ids.includes(a.user_id)).map(copy),
    async addAccount(row) {
      if (accounts.some((a) => a.tg_id === row.tg_id || a.user_id === row.user_id)) throw new DuplicateError("already linked");
      accounts.push({ ...row });
    },
    updateAccount: async (tgId, patch) => void Object.assign(accounts.find((a) => a.tg_id === tgId) || {}, patch),
    async removeAccount(userId) {
      const i = accounts.findIndex((a) => a.user_id === userId);
      if (i >= 0) accounts.splice(i, 1);
    },
    async listAccounts({ search, page, size }) {
      const q = search.trim().toLowerCase().replace(/^[@+]/, "");
      const hit = accounts.filter((a) => !q || [a.first_name, a.last_name, a.username, a.phone, a.tg_id].some((v) => String(v ?? "").toLowerCase().includes(q))).reverse();
      return { rows: hit.slice((page - 1) * size, page * size).map(copy), total: hit.length };
    }
  };
}
