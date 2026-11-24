// The way the family actually works (Nov 2026):
//   • the account's shift is 4pm–1am = 9 paid hours (8 work + 1 lunch); times are written
//     continuously, lunch inside them ("Option A")
//   • the lunch hour is shared equally by that day's workers unless they agree otherwise,
//     or goes to the account owner (ate) when she does the AR calls in it
//   • OT: all hours at the OT rate once the minimum is reached, else the regular rate; the
//     minimum is per OT offer if the offer has one, otherwise per month
//   • rest days Wed/Thu, shift time and OT minimum can change month to month, leave days
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, EMPTY } from '../web/src/engine.js'

const setup = async (names = ['Me', 'Sib', 'Ate']) => {
  const e = createEngine(EMPTY()), call = (m, u, b) => e.handle(m, u, b), id = {}
  await call('PUT', '/settings', { timezone: 'Asia/Manila' })
  for (const n of names) id[n] = (await call('POST', '/workers', { name: n, rate: 5 })).id
  if (id.Ate) await call('POST', `/workers/${id.Ate}/owner`, { owner: true })
  return { e, call, id }
}
const w = (worker_id, time_in, time_out, extra = {}) => ({ worker_id, status: 'worked', time_in, time_out, ...extra })
const hours = async (call, date) => Object.fromEntries((await call('GET', `/day/${date}`)).workers.filter((x) => x.row.hours).map((x) => [x.name, Math.round(x.row.hours * 1000) / 1000]))
const total = (h) => Math.round(Object.values(h).reduce((a, b) => a + b, 0) * 1000) / 1000

test('a 4pm–1am shift written as one continuous block pays 9 hours, never 10', async () => {
  const { call, id } = await setup()
  await call('PUT', '/day/2026-11-07', { entries: [w(id.Me, '16:00', '20:30'), w(id.Sib, '20:30', '01:00')] })
  assert.deepEqual(await hours(call, '2026-11-07'), { Me: 4.5, Sib: 4.5 })
  await call('PUT', '/day/2026-11-08', { entries: [w(id.Me, '16:00', '01:00')] })
  assert.deepEqual(await hours(call, '2026-11-08'), { Me: 9 })                       // alone: the whole 9 hours
  const r = await call('PUT', '/day/2026-11-09', { entries: [w(id.Me, '16:00', '19:00'), w(id.Sib, '19:00', '22:00'), w(id.Ate, '22:00', '01:00')] })
  assert.deepEqual(r.warnings, [])
  assert.deepEqual(await hours(call, '2026-11-09'), { Me: 3, Sib: 3, Ate: 3 })
})

test('equal lunch split when the blocks are uneven: the day still adds up to 9', async () => {
  const { call, id } = await setup()
  await call('PUT', '/day/2026-11-07', { entries: [w(id.Me, '16:00', '22:00'), w(id.Sib, '22:00', '01:00')] })
  const h = await hours(call, '2026-11-07')
  // 6 of the 9 hours covered → 6 − 40 min (its part of the lunch) + 30 min (equal lunch share)
  assert.deepEqual(h, { Me: 5.833, Sib: 3.167 }); assert.equal(total(h), 9)
})

test('lunch given to ate (she does the AR calls) — whether or not she covered a block', async () => {
  const { call, id } = await setup()
  // ate did not take a block, but did the calls during lunch: the hour is hers
  await call('PUT', '/day/2026-11-07', { entries: [w(id.Me, '16:00', '20:30'), w(id.Sib, '20:30', '01:00'), { worker_id: id.Ate, status: 'not_worked', lunch_min: 60 }] })
  let h = await hours(call, '2026-11-07')
  assert.deepEqual(h, { Me: 4, Sib: 4, Ate: 1 }); assert.equal(total(h), 9)
  // ate covered a block to lighten the load AND took the lunch
  await call('PUT', '/day/2026-11-08', { entries: [w(id.Me, '16:00', '21:00'), w(id.Ate, '21:00', '01:00', { lunch_min: 60 })] })
  h = await hours(call, '2026-11-08')
  assert.equal(total(h), 9); assert.deepEqual(h, { Me: 4.444, Ate: 4.556 })          // each gives up their part of the hour; ate gets it all
  // custom split agreed between the workers
  await call('PUT', '/day/2026-11-09', { entries: [w(id.Me, '16:00', '20:30', { lunch_min: 45 }), w(id.Sib, '20:30', '01:00', { lunch_min: 15 })] })
  assert.deepEqual(await hours(call, '2026-11-09'), { Me: 4.75, Sib: 4.25 })
  // more lunch than there is
  await assert.rejects(call('PUT', '/day/2026-11-10', { entries: [w(id.Me, '16:00', '20:30', { lunch_min: 50 }), w(id.Sib, '20:30', '01:00', { lunch_min: 50 })] }), /More lunch was given out/)
})

test('work hours only (lunch not in the times): the lunch hour is ADDED and shared', async () => {
  const { call, id } = await setup()
  // typed as hours: 4h + 4h = 8h of work → +30 min each
  let r = await call('PUT', '/day/2026-11-07', { entries: [w(id.Me, '16:00', '20:00'), w(id.Sib, '20:00', '00:00')] })
  assert.deepEqual(r.warnings, []); assert.deepEqual(await hours(call, '2026-11-07'), { Me: 4.5, Sib: 4.5 })
  // one worker did the whole 8h; the other did not work but is given the lunch hour → no lunch for the worker
  await call('PUT', '/day/2026-11-08', { entries: [w(id.Me, '16:00', '00:00'), { worker_id: id.Sib, status: 'not_worked', lunch_min: 60 }] })
  assert.deepEqual(await hours(call, '2026-11-08'), { Me: 8, Sib: 1 })
  // 4h + 4h, lunch to ate (calls)
  await call('PUT', '/day/2026-11-09', { entries: [w(id.Me, '16:00', '20:00'), w(id.Sib, '20:00', '00:00'), { worker_id: id.Ate, status: 'not_worked', lunch_min: 60 }] })
  assert.deepEqual(await hours(call, '2026-11-09'), { Me: 4, Sib: 4, Ate: 1 })
  // alone, 8h of work → 9 paid
  await call('PUT', '/day/2026-11-10', { entries: [w(id.Me, '16:00', '00:00')] })
  assert.deepEqual(await hours(call, '2026-11-10'), { Me: 9 })
  // times with the lunch break as a gap (4–8pm, lunch, 9pm–1am): no warning, 4.5 each
  r = await call('PUT', '/day/2026-11-11', { entries: [w(id.Me, '16:00', '20:00'), w(id.Sib, '21:00', '01:00')] })
  assert.deepEqual(r.warnings, []); assert.deepEqual(await hours(call, '2026-11-11'), { Me: 4.5, Sib: 4.5 })
})

test('a day that does not match the month\'s shift, or has a hole, is flagged', async () => {
  const { call, id } = await setup()
  let r = await call('PUT', '/day/2026-11-07', { entries: [w(id.Me, '16:00', '19:00'), w(id.Sib, '21:00', '01:00')] })
  assert.deepEqual(r.warnings.map((x) => x.type).sort(), ['gap', 'shift'])          // 2h hole, only 7h + 1h lunch
  r = await call('PUT', '/day/2026-11-08', { entries: [w(id.Me, '16:00', '22:00')] })
  assert.deepEqual(r.warnings, [{ type: 'shift', logged: 420, shift: 540 }])          // 6h + 1h lunch of a 9h shift
  r = await call('PUT', '/day/2026-11-09', { entries: [w(id.Me, '16:00', '03:00')] })
  assert.equal(r.warnings[0].type, 'shift')                                            // longer than the shift (OT goes in its own field)
  // the shift moved to 5pm–2am for December: a 5pm–2am day is fine there
  await call('PUT', '/schedule/2026-12', { shift_start: '17:00', shift_end: '02:00' })
  r = await call('PUT', '/day/2026-12-05', { entries: [w(id.Me, '17:00', '02:00')] })
  assert.deepEqual(r.warnings, [])
  assert.equal((await call('GET', '/schedule/2027-01')).shift_start, '17:00')          // January copies December
})

test('OT minimum per MONTH: every OT hour of the month from everyone counts', async () => {
  const { call, id } = await setup()
  await call('PUT', '/schedule/2026-10', { ot_min: 15, ot_rate: 8 })
  const day = (d, otMe, otSib) => call('PUT', `/day/${d}`, { entries: [w(id.Me, '16:00', '20:30', { ot_hours: 0 }), w(id.Sib, '20:30', '01:00', { ot_hours: otSib })].map((x, i) => i === 0 ? { ...x, ot_hours: otMe } : x) })
  await day('2026-10-05', 0, 4); await day('2026-10-12', 0, 4); await day('2026-10-19', 0, 3)
  const pay = async () => Object.fromEntries((await call('GET', '/summary/2026-10')).rows.filter((r) => r.otHours).map((r) => [r.worker.name, [r.otHours, r.otPay]]))
  assert.deepEqual(await pay(), { Sib: [11, 55] })                                      // 11 h < 15 → regular $5
  // two announcements in the month WITHOUT their own minimum: their hours still count for the month
  await call('POST', '/offers', { name: 'Wk 4', start_date: '2026-10-26', end_date: '2026-10-30', qualified_rate: 8 })
  await call('PUT', '/day/2026-10-28', { entries: [{ worker_id: id.Me, status: 'rdot', time_in: '16:00', time_out: '20:00' }] })   // rest-day OT, Wed
  assert.deepEqual(await pay(), { Me: [4, 32], Sib: [11, 88] })                          // 15 h reached → every OT hour $8
  const sum = await call('GET', '/summary/2026-10')
  assert.deepEqual([sum.otMonth.total, sum.otMonth.min, sum.otMonth.qualified, sum.otMonth.final], [15, 15, true, true])
  // November copies October's minimum and is provisional until the month is over
  assert.equal((await call('GET', '/schedule/2026-11')).ot_min, 15)
})

test('OT minimum per OFFER when the announcement sets its own', async () => {
  const { call, id } = await setup()
  await call('PUT', '/schedule/2026-10', { ot_min: 20, ot_rate: 8 })
  await call('POST', '/offers', { name: '2-week OT', start_date: '2026-10-05', end_date: '2026-10-18', min_hours: 6, qualified_rate: 8 })
  await call('PUT', '/day/2026-10-05', { entries: [w(id.Me, '16:00', '01:00', { ot_hours: 3 })] })
  await call('PUT', '/day/2026-10-06', { entries: [w(id.Sib, '16:00', '01:00', { ot_hours: 3 })] })
  await call('PUT', '/day/2026-10-26', { entries: [w(id.Sib, '16:00', '01:00', { ot_hours: 2 })] })      // outside the offer: monthly pool
  const rows = Object.fromEntries((await call('GET', '/summary/2026-10')).rows.map((r) => [r.worker.name, r.otPay]))
  assert.deepEqual(rows, { Me: 24, Sib: 24 + 10, Ate: 0 })                             // offer: 6 h reached → $8; month: 2 h of 20 → $5
})

test('leave days: no work can be logged and they are not "missing"', async () => {
  const { call, id } = await setup()
  await call('PUT', '/day/2026-11-02', { account: { day_off: 'leave' }, entries: [] })
  await assert.rejects(call('PUT', '/day/2026-11-02', { entries: [w(id.Me, '16:00', '01:00')] }), /marked as leave/)
  const sum = await call('GET', '/summary/2026-11')
  assert.ok(!sum.missingDays.includes('2026-11-02'))
  assert.ok(!sum.missingDays.includes('2026-11-04') && !sum.missingDays.includes('2026-11-05'))   // Wed, Thu = rest days
  assert.ok(sum.missingDays.includes('2026-11-03'))
  assert.deepEqual((await call('GET', '/calendar/2026-11')).leave, ['2026-11-02'])
})

test('one account owner at a time', async () => {
  const { call, id } = await setup()
  await call('POST', `/workers/${id.Me}/owner`, { owner: true })
  const ws = await call('GET', '/workers')
  assert.deepEqual(ws.filter((x) => x.owner).map((x) => x.name), ['Me'])
})

test('a paid month\'s shift time and OT settings are locked', async () => {
  const { call, id } = await setup()
  await call('PUT', '/day/2026-10-05', { entries: [w(id.Me, '16:00', '01:00')] })
  await call('PUT', `/paid/2026-10/${id.Me}`, { paid: true })
  await assert.rejects(call('PUT', '/schedule/2026-10', { ot_min: 10 }), /already paid/)
  await call('PUT', '/schedule/2026-10', { weekdays: [3, 4] })                          // rest days are just a planning aid
})

test('records from before the switch keep the older "lunch added on top" numbers', async () => {
  const s = EMPTY()
  s.settings.lunch_rule = 2; s.settings.lunch_from = null
  s.workers = [{ id: 1, name: 'A', active: true }]; s.rates = [{ worker_id: 1, effective_from: '2000-01-01', rate: 5 }]
  s.entries = [{ id: 2, worker_id: 1, date: '2025-03-10', status: 'worked', time_in: '16:00', time_out: '00:00', ot_hours: 0 }]   // 8 h + lunch gap
  const e = createEngine(s), call = (m, u, b) => e.handle(m, u, b)
  assert.equal((await call('GET', '/summary/2025-03')).totals.regularHours, 9)          // 8 h worked + 1 h lunch, as before
  assert.equal(e.state.settings.lunch_inside_from, new Intl.DateTimeFormat('en-CA', { timeZone: e.state.settings.timezone }).format(new Date()))
})
