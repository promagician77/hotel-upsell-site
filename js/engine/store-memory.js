// In-memory store with the same interface as the SQLite store on the server.
export class MemoryStore {
  constructor() { this.docs = new Map(); this.byRes = new Map(); this.counts = new Map(); this.logs = []; }
  _idx(kind, id, obj) {
    const k = `${kind}|${obj?.resId}`;
    if (obj?.resId == null) return;
    if (!this.byRes.has(k)) this.byRes.set(k, new Set());
    this.byRes.get(k).add(id);
  }
  _k(kind) { if (!this.docs.has(kind)) this.docs.set(kind, new Map()); return this.docs.get(kind); }
  get(kind, id) { const v = this._k(kind).get(id); return v === undefined ? null : structuredClone(v); }
  put(kind, id, obj) { this._k(kind).set(id, structuredClone(obj)); this._idx(kind, id, obj); }
  del(kind, id) { this._k(kind).delete(id); }
  /** All documents of a kind, or only those whose resId matches. */
  list(kind, resId) {
    if (resId == null) return [...this._k(kind).values()].map((v) => structuredClone(v));
    const ids = this.byRes.get(`${kind}|${resId}`) || new Set();
    return [...ids].map((id) => this._k(kind).get(id)).filter((v) => v && v.resId === resId).map((v) => structuredClone(v));
  }
  /** Sets job.status from `from` to `to` only if it is still `from`. */
  claim(kind, id, from, to) {
    const v = this._k(kind).get(id);
    if (!v || v.status !== from) return false;
    v.status = to;
    return true;
  }
  getCount(key) { return this.counts.get(key) || 0; }
  force(keys, delta) { for (const k of keys) this.counts.set(k, this.getCount(k) + delta); }
  /** Takes one unit from every counter, or from none if any would exceed its cap. */
  tryTake(entries) {
    if (entries.some((e) => this.getCount(e.key) + 1 > e.cap)) return false;
    for (const e of entries) this.counts.set(e.key, this.getCount(e.key) + 1);
    return true;
  }
  release(keys) { for (const k of keys) this.counts.set(k, Math.max(0, this.getCount(k) - 1)); }
  append(entry) { this.logs.push(structuredClone(entry)); }
  tail(n = 200, resId) { const l = resId ? this.logs.filter((e) => e.resId === resId) : this.logs; return l.slice(-n).map((e) => structuredClone(e)); }
}
