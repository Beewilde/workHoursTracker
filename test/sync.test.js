import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, EMPTY } from '../web/src/engine.js'
import { createSync, localRows, normalize } from '../web/src/sync.js'
import { fakeServer } from './fake-supabase.js'

const HH = '11111111-1111-4111-8111-111111111111'
// one "phone": its own engine + its own sync meta, talking to the shared fake server
function phone(srv) {
  const meta = { household_id: HH }
  let e
  const p = {
    saves: 0,
    get state() { return e.state },
    call: (m, u, b) => e.handle(m, u, b),
  }
  e = createEngine(EMPTY(), () => { p.saves++ })
  p.sync = createSync({ client: srv.client, getState: () => e.state, persist: () => { p.saves++ }, meta, saveMeta: () => {} })
  p.run = () => p.sync.sync()
  return p
}
const day = (w, a, b, extra = {}) => ({ worker_id: w, status: 'worked', time_in: a, time_out: b, ...extra })

test('a worker and a day logged on one phone appear on the other', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  const w = (await A.call('POST', '/workers', { name: 'Alex', rate: 5 })).id
  await A.call('PUT', '/day/2026-11-02', { entries: [day(w, '16:00', '20:30')] })
  assert.equal((await A.run()).state, 'ok')
  assert.equal((await B.run()).state, 'ok')
  assert.equal(B.state.workers[0].name, 'Alex')
  assert.equal(B.state.entries[0].time_out, '20:30')
  assert.equal((await B.call('GET', '/summary/2026-11')).totals.total, 22.5)
})

test('nothing is re-uploaded once both phones agree', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  const w = (await A.call('POST', '/workers', { name: 'Alex', rate: 5.125 })).id
  await A.call('PUT', '/day/2026-11-02', { entries: [day(w, '16:00', '17:20', { lunch_min: 13.3333 })] })
  await A.run(); await B.run(); await A.run()
  const before = srv.db.entries[0].updated_at
  await A.run(); await B.run()
  assert.equal(srv.db.entries[0].updated_at, before)
})

test('deletions travel too', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  const w = (await A.call('POST', '/workers', { name: 'Alex', rate: 5 })).id
  await A.call('PUT', '/day/2026-11-02', { entries: [day(w, '16:00', '20:30')] })
  const { id: bonus } = await A.call('POST', '/bonuses', { worker_id: w, review_date: '2026-11-03', amount: 10 })
  await A.run(); await B.run()
  assert.equal(B.state.bonuses.length, 1)
  await B.call('DELETE', `/bonuses/${bonus}`)
  await B.call('PUT', '/day/2026-11-02', { entries: [] })
  await B.run(); await A.run()
  assert.equal(A.state.bonuses.length, 0); assert.equal(A.state.entries.length, 0)
  assert.equal(srv.db.tombstones.length, 2)
})

test('offline on both phones: different days merge, the same day goes to whoever syncs last', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  const w = (await A.call('POST', '/workers', { name: 'Alex', rate: 5 })).id
  await A.run(); await B.run()
  await A.call('PUT', '/day/2026-11-02', { entries: [day(w, '16:00', '20:30')] })
  await A.call('PUT', '/day/2026-11-05', { entries: [day(w, '16:00', '18:00')] })
  await B.call('PUT', '/day/2026-11-03', { entries: [day(w, '20:30', '01:00')] })
  await B.call('PUT', '/day/2026-11-05', { entries: [day(w, '16:00', '19:00')] })
  await A.run(); await B.run(); await A.run()
  for (const p of [A, B]) {
    assert.deepEqual(p.state.entries.map((e) => e.date).sort(), ['2026-11-02', '2026-11-03', '2026-11-05'])
    assert.equal(p.state.entries.find((e) => e.date === '2026-11-05').time_out, '19:00')
  }
  assert.equal(srv.db.entries.length, 3)
})

test('settings are shared', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  await A.call('PUT', '/settings', { default_review_bonus: 12 })
  await A.run(); await B.run()
  assert.equal(B.state.settings.default_review_bonus, 12)
  assert.equal(srv.db.households[0].timezone, A.state.settings.timezone)
})

test('marking paid syncs, and a change the server refuses is rolled back on the phone', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  const w = (await A.call('POST', '/workers', { name: 'Alex', rate: 5 })).id
  await A.call('PUT', '/day/2026-10-02', { entries: [day(w, '16:00', '20:30')] })
  await A.run(); await B.run()
  // B goes offline and edits October; meanwhile A marks October paid
  await B.call('PUT', '/day/2026-10-02', { entries: [day(w, '16:00', '22:00')] })
  await A.call('PUT', `/paid/2026-10/${w}`, { paid: true })
  await A.run()
  assert.equal(srv.db.payouts.length, 1); assert.equal(srv.db.payouts[0].total, 22.5)
  // the real database's trigger refuses edits in a paid month; do the same here
  srv.refuse = (t, r) => t === 'entries' && srv.db.payouts.some((p) => p.worker_id === r.worker_id && r.date.startsWith(p.month)) ? 'Month 2026-10 is marked paid' : null
  const st = await B.run()
  assert.equal(st.state, 'warning'); assert.match(st.rejected[0].message, /marked paid/)
  assert.equal(B.state.entries[0].time_out, '20:30')                  // B now shows the server's version
  assert.ok(B.state.paid[`2026-10|${w}`])                              // and knows the month is paid
})

test('a server error leaves the phone unchanged and the change waiting', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv)
  await A.call('POST', '/workers', { name: 'Alex', rate: 5 })
  const real = srv.client.from
  srv.client.from = () => { throw new Error('Failed to fetch') }
  const st = await A.run()
  assert.equal(st.state, 'offline'); assert.equal(A.state.workers.length, 1)
  srv.client.from = real
  assert.equal((await A.run()).state, 'ok'); assert.equal(srv.db.workers.length, 1)
})

test('more than 1000 rows are read in pages', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  const ws = []
  for (const n of ['A', 'B', 'C', 'D']) ws.push((await A.call('POST', '/workers', { name: n, rate: 5 })).id)
  for (let i = 0; i < 300; i++) {
    const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)
    for (const w of ws) A.state.entries.push({ id: crypto.randomUUID(), worker_id: w, date: d, status: 'rd', time_in: null, time_out: null, ot_hours: 0 })
  }
  await A.run(); await B.run()
  assert.equal(B.state.entries.length, 1200)
})

test('normalize makes phone rows and Postgres rows compare equal', () => {
  const phoneRow = { id: 'x', worker_id: 'w', date: '2026-11-02', status: 'worked', time_in: '16:00', time_out: '20:30', ot_hours: 0, lunch_min: '' }
  const pgRow = { ...phoneRow, time_in: '16:00:00', time_out: '20:30:00', lunch_min: null, ot_hours: '0', household_id: 'h', updated_at: 'z' }
  assert.deepEqual(normalize('entries', phoneRow), normalize('entries', pgRow))
  assert.equal(localRows(EMPTY()).entries.size, 0)
})

test('month settings, the account owner and leave days sync too', async () => {
  const srv = fakeServer(); srv.addHousehold(HH)
  const A = phone(srv), B = phone(srv)
  const ate = (await A.call('POST', '/workers', { name: 'Ate', rate: 5 })).id
  await A.call('POST', `/workers/${ate}/owner`, { owner: true })
  await A.call('PUT', '/schedule/2026-12', { shift_start: '17:00', shift_end: '02:00', ot_min: 18, ot_rate: 8 })
  await A.call('PUT', '/day/2026-12-01', { account: { day_off: 'leave' }, entries: [] })
  await A.run(); await B.run()
  const s = await B.call('GET', '/schedule/2026-12')
  assert.deepEqual([s.shift_start, s.shift_end, s.ot_min, s.confirmed], ['17:00', '02:00', 18, true])
  assert.equal((await B.call('GET', '/workers'))[0].owner, true)
  assert.equal((await B.call('GET', '/day/2026-12-01')).isLeave, true)
  await A.run(); assert.equal((await A.run()).state, 'ok')
  const before = srv.requests; await A.run(); await B.run()
  assert.equal(srv.db.schedules.length, 1)
  assert.ok(srv.requests - before < 40)                                                   // nothing re-uploaded
})
