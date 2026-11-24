import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, EMPTY, migrateIds } from '../web/src/engine.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const setup = async () => {
  const e = createEngine(EMPTY()), call = (m, u, b) => e.handle(m, u, b)
  const a = (await call('POST', '/workers', { name: 'A', rate: 5 })).id
  const b = (await call('POST', '/workers', { name: 'B', rate: 5 })).id
  return { e, call, a, b }
}

test('new records get UUIDs', async () => {
  const { a, b } = await setup()
  assert.match(a, UUID); assert.match(b, UUID); assert.notEqual(a, b)
})

test('re-saving a day keeps the entries of a worker who was made inactive', async () => {
  const { e, call, a, b } = await setup()
  await call('PUT', '/day/2026-11-02', { entries: [
    { worker_id: a, status: 'worked', time_in: '16:00', time_out: '20:30' },
    { worker_id: b, status: 'worked', time_in: '20:30', time_out: '01:00' }] })
  await call('POST', `/workers/${b}/active`, { active: false })
  const day = await call('GET', '/day/2026-11-02')
  assert.equal(day.workers.length, 1)
  await call('PUT', '/day/2026-11-02', { entries: day.workers.map((w) => ({ worker_id: w.id, ...w.entry })) })
  assert.equal(e.state.entries.filter((x) => x.worker_id === b).length, 1)
  // an ACTIVE worker left out of the payload is still cleared, as before
  await call('PUT', '/day/2026-11-02', { entries: [] })
  assert.equal(e.state.entries.filter((x) => x.worker_id === a).length, 0)
  assert.equal(e.state.entries.filter((x) => x.worker_id === b).length, 1)
})

test('a rate change cannot reach back into a paid month', async () => {
  const { call, a } = await setup()
  await call('PUT', '/day/2026-11-02', { entries: [{ worker_id: a, status: 'worked', time_in: '16:00', time_out: '20:30' }] })
  await call('PUT', `/paid/2026-11/${a}`, { paid: true })
  await assert.rejects(call('POST', `/workers/${a}/rates`, { effective_from: '2026-11-15', rate: 9 }), /already paid/)
  await call('POST', `/workers/${a}/rates`, { effective_from: '2026-12-01', rate: 9 })
  const row = (await call('GET', '/summary/2026-11')).rows.find((r) => r.worker.id === a)
  assert.equal(row.total, 27.5); assert.equal(row.paidTotal, 27.5); assert.equal(row.changedSincePaid, false)   // 4h30 + the 1h lunch (alone that day)
})

test('a paid month shows when later setting changes would give a different total', async () => {
  const { call, a, b } = await setup()
  await call('PUT', '/day/2026-11-02', { entries: [
    { worker_id: a, status: 'worked', time_in: '16:00', time_out: '20:00' },
    { worker_id: b, status: 'worked', time_in: '20:00', time_out: '00:00' }] })
  await call('PUT', `/paid/2026-11/${a}`, { paid: true })
  await call('PUT', '/settings', { lunch_minutes: 30 })                          // lunch made shorter after the month was paid
  const row = (await call('GET', '/summary/2026-11')).rows.find((r) => r.worker.id === a)
  assert.equal(row.paidTotal, 22.5); assert.equal(row.total, 21.25); assert.equal(row.changedSincePaid, true)
})

test('an OT offer with paid OT cannot have its dates or rates changed', async () => {
  const { call, a } = await setup()
  const body = { name: 'Sep', start_date: '2025-09-01', end_date: '2025-09-10', cap_hours: 3, min_hours: 10, qualified_rate: 8 }
  const { id } = await call('POST', '/offers', body)
  await call('PUT', '/day/2025-09-02', { entries: [{ worker_id: a, status: 'worked', time_in: '16:00', time_out: '20:30', ot_hours: 1 }] })
  await assert.rejects(call('PUT', `/offers/${id}`, { ...body, start_date: '2025-09-03' }), /fall outside/)
  await call('PUT', `/offers/${id}`, { ...body, qualified_rate: 9 })            // not paid yet: allowed
  await call('PUT', `/paid/2025-09/${a}`, { paid: true })
  await assert.rejects(call('PUT', `/offers/${id}`, { ...body, qualified_rate: 10 }), /already paid/)
  await call('PUT', `/offers/${id}`, { ...body, qualified_rate: 9, notes: 'ok' })  // notes only: allowed
})

test('v1 data with number ids is converted to UUIDs with every link kept', () => {
  const s = EMPTY()
  Object.assign(s, {
    v: 1, seq: 9,
    workers: [{ id: 1, name: 'A', active: true }, { id: 2, name: 'B', active: true }],
    rates: [{ worker_id: 1, effective_from: '2000-01-01', rate: 5 }],
    offers: [{ id: 3, name: 'O', start_date: '2026-11-01', end_date: '2026-11-10' }],
    entries: [{ id: 4, worker_id: 2, date: '2026-11-02', status: 'worked', ot_offer_id: 3, ot_hours: 1 }],
    bonuses: [{ id: 5, worker_id: 1, pay_month: '2026-11', amount: 10 }],
    paid: { '2026-10|2': '2026-11-01T00:00:00Z' },
  })
  migrateIds(s)
  const [A, B] = s.workers.map((w) => w.id)
  assert.match(A, UUID)
  assert.equal(s.rates[0].worker_id, A); assert.equal(s.bonuses[0].worker_id, A)
  assert.equal(s.entries[0].worker_id, B); assert.equal(s.entries[0].ot_offer_id, s.offers[0].id)
  assert.deepEqual(Object.keys(s.paid), [`2026-10|${B}`])
  assert.equal(s.seq, undefined); assert.equal(s.v, 2)
  const again = JSON.stringify(s); migrateIds(s); assert.equal(JSON.stringify(s), again)   // idempotent
})
