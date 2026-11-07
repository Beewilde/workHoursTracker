import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { createEngine, EMPTY } from '../web/src/engine.js'
import { buildWorkbook } from '../shared/export.js'

let saves = 0
const e = createEngine(EMPTY(), () => saves++)
const call = (m, u, b) => e.handle(m, u, b)
const ids = {}

test('workers, rates, presets', async () => {
  await call('PUT', '/settings', { timezone: 'Asia/Manila' })
  for (const n of ['Alex', 'Sam', 'Jo']) ids[n] = (await call('POST', '/workers', { name: n, rate: 5 })).id
  await assert.rejects(call('POST', '/workers', { name: 'alex', rate: 5 }), /already used/)
  await call('POST', `/workers/${ids.Sam}/rates`, { effective_from: '2026-10-31', rate: 5.5 })
  const w = (await call('GET', '/workers')).find((x) => x.name === 'Sam')
  assert.equal(w.rates.length, 2)
  assert.ok(saves > 0)
})

test('rest-day schedule is per month and copies forward as a suggestion', async () => {
  assert.deepEqual((await call('GET', '/schedule/2026-10')).weekdays, [2, 3, 4])      // default suggestion
  await call('PUT', '/schedule/2026-10', { weekdays: [1, 2, 3] })
  const nov = await call('GET', '/schedule/2026-11')
  assert.deepEqual(nov.weekdays, [1, 2, 3]); assert.equal(nov.confirmed, false)
  const day = await call('GET', '/day/2026-10-20')     // a Tuesday
  assert.equal(day.isRestDay, true)
})

test('split shift, overlap, OT cap and pooled OT', async () => {
  const o = await call('POST', '/offers', { name: 'Wk OT', start_date: '2026-10-19', end_date: '2026-10-25', cap_hours: 5, min_hours: 10, qualified_rate: 8 })
  assert.ok(o.id)
  await assert.rejects(call('POST', '/offers', { name: 'Clash', start_date: '2026-10-25', end_date: '2026-10-26', cap_hours: 2, min_hours: 1, qualified_rate: 8 }), /overlap/)

  await assert.rejects(call('PUT', '/day/2026-10-20', { entries: [
    { worker_id: ids.Sam, status: 'worked', time_in: '16:00', time_out: '21:00' },
    { worker_id: ids.Alex, status: 'worked', time_in: '20:30', time_out: '01:00' }] }), (err) => err.status === 409 && err.data.needsConfirm)

  const ok = await call('PUT', '/day/2026-10-20', { account: { company_hours: 10 }, entries: [
    { worker_id: ids.Sam, status: 'worked', time_in: '16:00', time_out: '20:30' },
    { worker_id: ids.Alex, status: 'worked', time_in: '20:30', time_out: '01:00', ot_hours: 2 }] })
  assert.equal(ok.day.coverage.status, 'ok'); assert.equal(ok.day.coverage.hours, 9); assert.deepEqual(ok.warnings, [])
  const el = ok.day.workers.find((w) => w.name === 'Alex').entry
  assert.deepEqual([el.ot_start, el.ot_end], ['01:00', '03:00'])

  await assert.rejects(call('PUT', '/day/2026-10-21', { entries: [
    { worker_id: ids.Alex, status: 'worked', time_in: '16:00', time_out: '01:00', ot_hours: 3 },
    { worker_id: ids.Sam, status: 'worked', time_in: '01:00', time_out: '02:00', ot_hours: 3 }] }), /capped at 5/)
  await assert.rejects(call('PUT', '/day/2026-10-28', { entries: [{ worker_id: ids.Alex, status: 'worked', time_in: '16:00', time_out: '01:00', ot_hours: 1 }] }), /No OT offer/)
  await assert.rejects(call('PUT', '/day/2026-10-28', { entries: [{ worker_id: ids.Alex, status: 'worked', time_in: '16:00', time_out: '01:00', rate_override: 6 }] }), /reason is required/)

  await call('PUT', '/day/2026-10-21', { entries: [
    { worker_id: ids.Sam, status: 'worked', time_in: '16:00', time_out: '20:30' },
    { worker_id: ids.Alex, status: 'worked', time_in: '20:30', time_out: '01:00', ot_hours: 3 }] })
  await call('PUT', '/day/2026-10-22', { entries: [
    { worker_id: ids.Sam, status: 'worked', time_in: '16:00', time_out: '01:00', ot_hours: 5 }, { worker_id: ids.Alex, status: 'rd' }] })
  const sum = await call('GET', '/summary/2026-10')
  const get = (n) => sum.rows.find((r) => r.worker.name === n)
  assert.equal(get('Alex').otHours, 5); assert.equal(get('Alex').otPay, 40)   // pooled 10 h reached -> $8 on every OT hour
  assert.equal(get('Sam').otPay, 40)
  const offers = await call('GET', '/offers')
  assert.equal(offers[0].stats.final, true); assert.equal(offers[0].contributions.length, 2)
})

test('bonuses, who-was-on-shift helper, notes parser, paid lock', async () => {
  const b = await call('POST', '/bonuses', { worker_id: ids.Alex, review_date: '2026-10-20', reference: 'review #1', amount: 10, chat_time: '22:00' })
  assert.ok(b.id)
  assert.deepEqual(await call('GET', '/covered?date=2026-10-20&time=22:00'), [{ id: ids.Alex, name: 'Alex' }])
  assert.equal((await call('GET', '/bonuses?month=2026-10'))[0].worker_name, 'Alex')
  const rows = await call('POST', '/parse', { text: 'jo oct 24 8:30pm-1am\nnonsense', year: 2026 })
  assert.equal(rows[0].ok, true); assert.equal(rows[1].ok, false)
  assert.equal((await call('POST', '/apply-notes', { items: rows })).saved, 1)
  assert.equal((await call('GET', '/day/2026-10-24')).workers.find((w) => w.name === 'Jo').entry.time_in, '20:30')

  await call('PUT', `/paid/2026-10/${ids.Sam}`, { paid: true })
  await assert.rejects(call('PUT', '/day/2026-10-20', { entries: [{ worker_id: ids.Sam, status: 'rd' }, { worker_id: ids.Alex, status: 'rd' }] }), /locked/)
  // another worker's edits on the same day still work; locked entries are left untouched
  const r = await call('PUT', '/day/2026-10-20', { entries: [
    { worker_id: ids.Sam, status: 'worked', time_in: '16:00', time_out: '20:30' },
    { worker_id: ids.Alex, status: 'worked', time_in: '20:30', time_out: '01:00', ot_hours: 2, remark: 'edited' }] })
  assert.equal(r.ok, true)
  await call('PUT', `/paid/2026-10/${ids.Sam}`, { paid: false })
})

test('Excel export: structure and formulas', async () => {
  const buf = await buildWorkbook(e.exportCtx('2026-10'), {})
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Alex - Oct', 'Sam - Oct', 'Jo - Oct', 'OT Summary', 'Account Daily'])
  const ws = wb.getWorksheet('Alex - Oct')
  assert.match(ws.getCell('K33').value.formula, /F33\+SUM\(K2:K32\)\+SUM\(Q2:Q200\)/)
  assert.equal(ws.getCell('K33').value.result, 25 * 2 + 40 + 10)  // 2 shifts: 4.5 h + 30 min paid lunch = 5 h x $5, + OT $40 + bonus $10
  assert.equal(ws.getCell('H2').value, null)
  const lunchRow = ws.getRows(2, 31).find((r) => r.getCell('H').value)
  assert.equal(lunchRow.getCell('H').value, 30)
  assert.match(lunchRow.getCell('D').value.formula, /MOD\(C\d+-B\d+,1\)\*24\+H\d+\/60/)
})

test('backup and restore round trip; bad files are rejected', async () => {
  const { json, filename } = e.backup()
  assert.match(filename, /^work-hours-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const before = (await call('GET', '/summary/2026-10')).totals.total
  e.reset()
  assert.equal((await call('GET', '/workers')).length, 0)
  e.restore(json)
  assert.equal((await call('GET', '/summary/2026-10')).totals.total, before)
  assert.throws(() => e.restore('not json'), /not a valid backup/)
  assert.throws(() => e.restore(JSON.stringify({ app: 'other', data: {} })), /not a Work Hours/)
  const m = e.meta(); assert.equal(m.hasData, true); assert.ok(m.lastBackupAt)
})

const fresh = () => { const x = createEngine(EMPTY()); return { x, call: (m, u, b) => x.handle(m, u, b) } }
const addTeam = async (call, names) => { const ids = {}; for (const n of names) ids[n] = (await call('POST', '/workers', { name: n, rate: 5 })).id; return ids }

test('paid lunch: an 8 h day shared by 3 workers adds 20 min each, paid at the same rate', async () => {
  const { call } = fresh()
  await call('PUT', '/settings', { timezone: 'Asia/Manila' })
  const id = await addTeam(call, ['Alex', 'Sam', 'Jo'])
  await call('PUT', '/day/2025-03-10', { entries: [
    { worker_id: id.Alex, status: 'worked', time_in: '16:00', time_out: '18:40' },
    { worker_id: id.Sam, status: 'worked', time_in: '18:40', time_out: '21:20' },
    { worker_id: id.Jo, status: 'worked', time_in: '21:20', time_out: '00:00' }] })
  const day = await call('GET', '/day/2025-03-10')
  assert.deepEqual(day.workers.map((w) => w.row.lunchMin), [20, 20, 20])
  assert.deepEqual(day.workers.map((w) => Math.round(w.row.hours * 60)), [180, 180, 180])      // 2h40 + 20 min = 3 h each
  assert.deepEqual(day.workers.map((w) => w.row.pay), [15, 15, 15])
  const sum = await call('GET', '/summary/2025-03')
  assert.equal(sum.totals.regularHours, 9); assert.equal(sum.totals.regularPay, 45)             // 8 h worked + 1 h lunch, all paid
})

test('paid lunch: two workers share $5 lunch ($2.50 each) and it follows each worker\'s own rate', async () => {
  const { call } = fresh()
  const a = (await call('POST', '/workers', { name: 'Alex', rate: 5 })).id, b = (await call('POST', '/workers', { name: 'Sam', rate: 6 })).id
  await call('PUT', '/day/2025-03-10', { entries: [
    { worker_id: a, status: 'worked', time_in: '16:00', time_out: '20:00' }, { worker_id: b, status: 'worked', time_in: '20:00', time_out: '00:00' }] })
  const w = (await call('GET', '/day/2025-03-10')).workers
  assert.deepEqual(w.map((x) => x.row.lunchMin), [30, 30])
  assert.equal(w[0].row.pay, 22.5)                       // (4 h + 0.5 h) x $5: the lunch part is $2.50
  assert.equal(w[1].row.pay, 27)                          // (4 h + 0.5 h) x $6
})

test('paid lunch: short days, training, manual overrides, company hours', async () => {
  const { call } = fresh()
  const id = await addTeam(call, ['Alex', 'Sam'])
  await call('PUT', '/day/2025-03-11', { entries: [{ worker_id: id.Alex, status: 'worked', time_in: '16:00', time_out: '20:30' }] })
  assert.equal((await call('GET', '/day/2025-03-11')).workers[0].row.hours, 4.5)                // short day: no lunch
  await call('PUT', '/day/2025-03-12', { entries: [
    { worker_id: id.Alex, status: 'worked', time_in: '16:00', time_out: '00:00' },
    { worker_id: id.Sam, status: 'training', time_in: '10:00', time_out: '11:00' }] })
  const d12 = await call('GET', '/day/2025-03-12')
  assert.equal(d12.workers.find((w) => w.name === 'Alex').row.hours, 9)                          // 8 h + 1 h lunch (training does not share it)
  assert.equal(d12.workers.find((w) => Number(w.row.elapsed) === 1).row.hours, 1)
  const one = [{ worker_id: id.Alex, status: 'worked', time_in: '16:00', time_out: '00:00' }]
  await call('PUT', '/day/2025-03-12', { account: { lunch_hours: 0 }, entries: one })
  assert.equal((await call('GET', '/day/2025-03-12')).workers[0].row.hours, 8)                   // 0 = no lunch that day
  await call('PUT', '/day/2025-03-12', { account: { lunch_hours: 0.5 }, entries: one })
  assert.equal((await call('GET', '/day/2025-03-12')).workers[0].row.hours, 8.5)
  // the company shows the whole shift including the lunch: 8 h worked + 1 h lunch = 9
  const ok = await call('PUT', '/day/2025-03-13', { account: { company_hours: 9 }, entries: [
    { worker_id: id.Alex, status: 'worked', time_in: '16:00', time_out: '20:00' }, { worker_id: id.Sam, status: 'worked', time_in: '20:00', time_out: '00:00' }] })
  assert.deepEqual(ok.warnings, [])
  const bad = await call('PUT', '/day/2025-03-13', { account: { company_hours: 8 }, entries: [
    { worker_id: id.Alex, status: 'worked', time_in: '16:00', time_out: '20:00' }, { worker_id: id.Sam, status: 'worked', time_in: '20:00', time_out: '00:00' }] })
  assert.equal(bad.warnings[0].type, 'mismatch')
})

const oldState = (settings = {}) => {
  const old = EMPTY()
  for (const k of ['lunch_rule', 'lunch_minutes', 'lunch_auto', 'lunch_threshold', 'lunch_from']) delete old.settings[k]
  Object.assign(old.settings, settings)
  old.workers = [{ id: 1, name: 'Alex', color: '#000', active: true }, { id: 2, name: 'Sam', color: '#111', active: true }]
  old.rates = [{ worker_id: 1, effective_from: '2000-01-01', rate: 5 }, { worker_id: 2, effective_from: '2000-01-01', rate: 5 }]
  old.entries = [
    { id: 3, worker_id: 1, date: '2025-03-10', status: 'worked', time_in: '16:00', time_out: '20:30', ot_hours: 0 },
    { id: 4, worker_id: 2, date: '2025-03-10', status: 'worked', time_in: '20:30', time_out: '01:00', ot_hours: 0 }]
  old.seq = 10
  return old
}
test('paid lunch: existing records keep their numbers until you choose to apply it to them', async () => {
  const x = createEngine(oldState()), call = (m, u, b) => x.handle(m, u, b)
  const settings = await call('GET', '/settings')
  assert.equal(settings.lunch_minutes, 60); assert.ok(settings.lunch_from)                      // starts from today
  assert.equal((await call('GET', '/summary/2025-03')).totals.regularHours, 9)                   // history unchanged
  await call('PUT', '/settings', { lunch_from: null })                                            // deliberate "apply to all past days"
  assert.equal((await call('GET', '/summary/2025-03')).totals.regularHours, 10)                  // 9 h worked + 1 h paid lunch
  await call('PUT', '/settings', { lunch_from: '2030-01-01' })
  assert.equal((await call('GET', '/summary/2025-03')).totals.regularHours, 9)
  await call('PUT', '/settings', { lunch_from: null, lunch_auto: false })
  assert.equal((await call('GET', '/summary/2025-03')).totals.regularHours, 9)
  const backup = JSON.stringify({ app: 'work-hours-tracker', version: 1, data: oldState() })    // restoring an old backup behaves the same
  const y = createEngine(EMPTY()); y.restore(backup)
  assert.ok(y.state.settings.lunch_from); assert.equal((await y.handle('GET', '/summary/2025-03')).totals.regularHours, 9)
})

test('paid lunch: data from the earlier "deduct lunch" version is switched to the paid-lunch rule', async () => {
  const x = createEngine(oldState({ lunch_auto: true, lunch_minutes: 60, lunch_threshold: 9, lunch_from: '2025-03-01' }))
  const s = await x.handle('GET', '/settings')
  assert.deepEqual([s.lunch_rule, s.lunch_threshold, s.lunch_from], [2, 8, '2025-03-01'])        // threshold now means WORKED hours; start date kept
  assert.equal((await x.handle('GET', '/summary/2025-03')).totals.regularHours, 10)               // lunch is added, not deducted
})
