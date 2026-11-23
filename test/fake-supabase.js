// In-memory stand-in for the parts of supabase-js that sync.js uses, with the same
// behaviour as the real schema for sync purposes: server-set updated_at, tombstones on
// delete, primary keys, 1000-row pages, and an optional "refuse this row" hook (like a trigger).
import { TABLES } from '../web/src/sync.js'

export function fakeServer() {
  let clock = Date.parse('2026-11-01T00:00:00Z')
  const tick = () => new Date((clock += 1000)).toISOString()
  const db = { households: [], tombstones: [] }
  for (const t of Object.keys(TABLES)) db[t] = []
  const pk = (t) => (t === 'households' ? ['id'] : t === 'tombstones' ? ['household_id', 'tbl', 'key'] : TABLES[t].key)
  const keyStr = (t, r) => TABLES[t].key.map((k) => String(r[k])).join('|')
  const srv = { db, refuse: null, requests: 0 }

  class Q {
    constructor(t) { this.t = t; this.filters = []; this.op = 'select'; this.rangeV = null; this.ord = null }
    select() { return this }
    eq(c, v) { this.filters.push((r) => String(r[c]) === String(v)); return this }
    gt(c, v) { this.filters.push((r) => r[c] > v); return this }
    order(c) { this.ord = c; return this }
    range(a, b) { this.rangeV = [a, b]; return this }
    upsert(rows) { this.op = 'upsert'; this.rows = rows; return this }
    update(v) { this.op = 'update'; this.val = v; return this }
    delete() { this.op = 'delete'; return this }
    match(r) { return this.filters.every((f) => f(r)) }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej) }
    run() {
      srv.requests++
      const tbl = db[this.t]
      if (this.op === 'select') {
        let out = tbl.filter((r) => this.match(r)).map((r) => structuredClone(r))
        if (this.ord) out.sort((a, b) => String(a[this.ord]).localeCompare(String(b[this.ord])))
        if (this.rangeV) out = out.slice(this.rangeV[0], this.rangeV[1] + 1)
        return { data: out, error: null }
      }
      if (this.op === 'upsert') {
        for (const r of this.rows) { const msg = srv.refuse?.(this.t, r); if (msg) return { data: null, error: { message: msg } } }
        for (const r of this.rows) {
          const i = tbl.findIndex((x) => pk(this.t).every((k) => String(x[k]) === String(r[k])))
          const row = { ...(i >= 0 ? tbl[i] : {}), ...structuredClone(r), updated_at: tick() }
          if (i >= 0) tbl[i] = row; else tbl.push(row)
          const ti = db.tombstones.findIndex((d) => d.tbl === this.t && d.key === keyStr(this.t, row))
          if (ti >= 0) db.tombstones.splice(ti, 1)
        }
        return { data: null, error: null }
      }
      if (this.op === 'update') {
        for (const r of tbl.filter((x) => this.match(x))) Object.assign(r, structuredClone(this.val), { updated_at: tick() })
        return { data: null, error: null }
      }
      if (this.op === 'delete') {
        for (const r of tbl.filter((x) => this.match(x))) { const msg = srv.refuse?.(this.t, r, 'delete'); if (msg) return { data: null, error: { message: msg } } }
        for (const r of tbl.filter((x) => this.match(x))) {
          db.tombstones.push({ household_id: r.household_id, tbl: this.t, key: keyStr(this.t, r), deleted_at: tick() })
        }
        db[this.t] = tbl.filter((x) => !this.match(x))
        return { data: null, error: null }
      }
    }
  }
  srv.client = { from: (t) => new Q(t) }
  srv.addHousehold = (id) => db.households.push({ id, settings: {}, updated_at: tick() })
  return srv
}
