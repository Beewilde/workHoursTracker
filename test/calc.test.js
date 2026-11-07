import test from 'node:test'
import assert from 'node:assert/strict'
import { spanMin, regHours, r2, coverage, deriveOT, evalOffers, monthReport, lunchPlan, paidHours } from '../shared/calc.js'
import { parseNotes } from '../shared/parse.js'

test('hours handle past-midnight shifts (matches the original sheet)', () => {
  assert.equal(spanMin('20:30', '01:00') / 60, 4.5)
  assert.equal(spanMin('16:00', '20:30') / 60, 4.5)
  assert.equal(spanMin('22:00', '01:30') / 60, 3.5)
  assert.equal(r2((spanMin('21:00', '02:20') / 60) * 5.5), 29.33)
  assert.equal(r2((spanMin('16:00', '17:20') / 60) * 5.5), 7.33)
  assert.equal(regHours({ status: 'rd', time_in: '10:00', time_out: '12:00' }), 0)
})

test('split shift coverage: ok, gap, overlap', () => {
  const ok = coverage([{ time_in: '16:00', time_out: '20:30' }, { time_in: '20:30', time_out: '01:00' }])
  assert.equal(ok.status, 'ok'); assert.equal(ok.hours, 9)
  assert.equal(coverage([{ time_in: '16:00', time_out: '20:30' }, { time_in: '21:00', time_out: '01:00' }]).gap, 30)
  assert.equal(coverage([{ time_in: '16:00', time_out: '20:30' }, { time_in: '20:00', time_out: '01:00' }]).overlap, 30)
  assert.equal(coverage([{ time_in: '16:00', time_out: '00:30' }, { time_in: '00:30', time_out: '04:00' }]).status, 'ok')
})

test('OT derives after/before the account shift and splits in time order', () => {
  const cov = coverage([{ time_in: '16:00', time_out: '01:00' }])
  assert.deepEqual(deriveOT(cov, 'after', [2, 3]), [{ ot_start: '01:00', ot_end: '03:00' }, { ot_start: '03:00', ot_end: '06:00' }])
  assert.deepEqual(deriveOT(cov, 'before', [3]), [{ ot_start: '13:00', ot_end: '16:00' }])
})

const offer = { id: 1, start_date: '2026-10-19', end_date: '2026-10-25', min_hours: 10, qualified_rate: 8, below_min_rate: null, tier_mode: 'whole' }
const rates = { 1: [{ effective_from: '2026-01-01', rate: 5 }], 2: [{ effective_from: '2026-01-01', rate: 5 }] }
const ent = (id, w, h, date = '2026-10-20') => ({ id, worker_id: w, date, ot_hours: h, ot_offer_id: 1, ot_start: '01:00' })

test('pooled OT: minimum reached -> $8 on every OT hour; below -> regular $5', () => {
  let r = evalOffers([offer], [ent(1, 1, 6), ent(2, 2, 5, '2026-10-21')], rates, '2026-10-30')
  assert.equal(r.byEntry[1].otPay, 48); assert.equal(r.byEntry[2].otPay, 40); assert.equal(r.stats[1].final, true)
  r = evalOffers([offer], [ent(1, 1, 5), ent(2, 2, 3, '2026-10-21')], rates, '2026-10-30')
  assert.equal(r.byEntry[1].otPay, 25); assert.equal(r.byEntry[2].otPay, 15)
  r = evalOffers([offer], [ent(1, 1, 5)], rates, '2026-10-22')
  assert.equal(r.byEntry[1].provisional, true); assert.equal(r.stats[1].remaining, 5)
})

test('marginal mode prices only hours past the minimum', () => {
  const r = evalOffers([{ ...offer, tier_mode: 'marginal' }], [ent(1, 1, 12)], rates, '2026-10-30')
  assert.equal(r.byEntry[1].otPay, 66)
})

test('month report totals include OT and review bonuses', () => {
  const workers = [{ id: 1, name: 'Alex' }]
  const entries = [
    { id: 1, worker_id: 1, date: '2026-10-04', status: 'worked', time_in: '16:00', time_out: '20:30', ot_hours: 0 },
    { id: 2, worker_id: 1, date: '2026-10-31', status: 'worked', time_in: '16:00', time_out: '17:20', ot_hours: 0, rate_override: 5.5 },
  ]
  const { report } = monthReport({ month: '2026-10', workers, rates, entries, offers: [], bonuses: [{ worker_id: 1, pay_month: '2026-10', amount: 10 }], today: '2026-11-01' })
  assert.equal(report[1].regularPay, 29.83)
  assert.equal(report[1].total, 39.83)
  assert.equal(report[1].notLogged, 29)
})

test('notes parser', () => {
  const w = [{ id: 1, name: 'Sam' }, { id: 2, name: 'Alex' }]
  const [a, b, c] = parseNotes('sam oct 24 8:30pm-1am ot 2h\nAlex 10/17 4pm to 8:30pm\nnothing here', w, 2026)
  assert.deepEqual([a.ok, a.date, a.time_in, a.time_out, a.ot_hours], [true, '2026-10-24', '20:30', '01:00', 2])
  assert.deepEqual([b.ok, b.date, b.time_in, b.time_out], [true, '2026-10-17', '16:00', '20:30'])
  assert.equal(c.ok, false)
})

const W = (a, b, status = 'worked') => ({ status, time_in: a, time_out: b })
test('lunchPlan: the paid lunch is shared equally and ADDED to each worker', () => {
  const three = [W('16:00', '18:40'), W('18:40', '21:20'), W('21:20', '00:00')]               // 2h40 each = 8 h worked
  const p = lunchPlan(three, { minutes: 60, threshold: 8 })
  assert.deepEqual([p.totalMin, p.perMin, p.n, p.elapsed, p.source], [60, 20, 3, 8, 'auto'])
  assert.equal(paidHours(three[0], p), 3)                                                     // 2h40 + 20 min
  assert.equal(three.reduce((s, e) => s + paidHours(e, p), 0), 9)                              // 8 h worked + 1 h paid lunch
  const two = [W('16:00', '20:00'), W('20:00', '00:00')]
  assert.equal(lunchPlan(two, {}).perMin, 30)
  assert.equal(paidHours(two[0], lunchPlan(two, {})), 4.5)
  assert.equal(lunchPlan([W('16:00', '00:00')], {}).perMin, 60)
})
test('lunchPlan: short days, training, switches and dates', () => {
  assert.equal(lunchPlan([W('16:00', '20:30')], {}).totalMin, 0)                               // not a full shift: no lunch
  const withTraining = [W('16:00', '00:00'), W('10:00', '11:00', 'training')]
  const p = lunchPlan(withTraining, {})
  assert.equal(p.n, 1); assert.equal(paidHours(withTraining[1], p), 1)                         // training gets no lunch
  assert.equal(lunchPlan([W('16:00', '00:00')], { override: 0 }).totalMin, 0)                  // manual 0 = none
  assert.equal(lunchPlan([W('16:00', '00:00')], { override: 0.5 }).perMin, 30)                 // manual 0.5 h
  assert.equal(lunchPlan([W('16:00', '00:00')], { override: '' }).totalMin, 60)                // blank = automatic
  assert.equal(lunchPlan([W('16:00', '00:00')], { auto: false }).totalMin, 0)
  assert.equal(lunchPlan([W('16:00', '00:00')], { from: '2026-02-01', date: '2026-01-31' }).totalMin, 0)
  assert.equal(lunchPlan([W('16:00', '00:00')], { from: '2026-02-01', date: '2026-02-01' }).totalMin, 60)
  assert.equal(lunchPlan([W('01:00', '01:00')], {}).n, 0)                                      // empty span ignored
})
test('monthReport adds the lunch share to hours and pay (and not when lunch is off)', () => {
  const workers = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
  const r = { 1: [{ effective_from: '2000-01-01', rate: 5 }], 2: [{ effective_from: '2000-01-01', rate: 6 }] }
  const entries = [{ id: 1, worker_id: 1, date: '2026-10-20', status: 'worked', time_in: '16:00', time_out: '20:00', ot_hours: 0 }, { id: 2, worker_id: 2, date: '2026-10-20', status: 'worked', time_in: '20:00', time_out: '00:00', ot_hours: 0 }]
  const base = { month: '2026-10', workers, rates: r, entries, offers: [], bonuses: [], today: '2026-11-01' }
  const on = monthReport({ ...base, lunch: { auto: true, minutes: 60, threshold: 8, from: null } }).report
  assert.deepEqual([on[1].regularHours, on[1].regularPay, on[1].lunchHours], [4.5, 22.5, 0.5])   // 4 h + 30 min lunch at $5 = $22.50
  assert.equal(on[2].regularPay, 27)                                                               // the lunch is paid at each worker's OWN rate: 4.5 h x $6
  assert.deepEqual([on[1].rows[19].elapsed, on[1].rows[19].lunchMin], [4, 30])
  const off = monthReport(base).report
  assert.deepEqual([off[1].regularHours, off[1].regularPay], [4, 20])
})
