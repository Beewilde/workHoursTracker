// The whole "backend", running inside the browser. Same rules as the server version,
// operating on one plain object (the state) that is saved to the device after every change.
import { monthReport, coverage, deriveOT, evalOffers, rateOn, toMin, spanMin, weekday, daysInMonth, lunchPlan } from '../../shared/calc.js'
import { parseNotes } from '../../shared/parse.js'

const COLORS = ['#4169A1', '#7C6EAB', '#D08B5B', '#4E8E77', '#B5546B', '#5A9BB5']
const STATUSES = ['worked', 'rd', 'not_worked', 'training']
const ISO = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/
const ENTRY_COLS = ['status', 'time_in', 'time_out', 'ot_hours', 'ot_start', 'ot_end', 'ot_position', 'ot_offer_id', 'rate_override', 'rate_override_reason', 'remark']
export const APP_ID = 'work-hours-tracker'

const defaultTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila' } catch { return 'Asia/Manila' } }
export const EMPTY = () => ({
  v: 1, seq: 1, workers: [], rates: [], entries: [], offers: [], bonuses: [], accountDays: {}, schedules: {}, paid: {}, lastBackupAt: null,
  settings: {
    timezone: defaultTz(), default_review_bonus: 10, rd_default: [2, 3, 4], reminder_days: 30,
    lunch_rule: 2, lunch_auto: true, lunch_minutes: 60, lunch_threshold: 8, lunch_from: null,
    presets: [{ label: 'Evening', time_in: '20:30', time_out: '01:00' }, { label: 'Early', time_in: '16:00', time_out: '20:30' }],
  },
})

export function createEngine(state, save = () => {}) {
  const S = state
  const err = (status, message, extra) => Object.assign(new Error(message), { status, data: { error: message, ...extra } })
  const need = (c, m) => { if (!c) throw err(400, m) }
  const num = (v, name, { min = 0, max = 1e6, nullable = false } = {}) => {
    if ((v === null || v === undefined || v === '') && nullable) return null
    const x = Number(v)
    if (!Number.isFinite(x) || x < min || x > max) throw err(400, `${name} is invalid`)
    return x
  }
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: S.settings.timezone }).format(new Date())
  const ratesBy = () => { const o = {}; for (const r of [...S.rates].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) (o[r.worker_id] ||= []).push(r); return o }
  const isPaid = (month, wid) => !!S.paid[`${month}|${wid}`]
  const offerFor = (date) => S.offers.find((o) => o.start_date <= date && o.end_date >= date)
  const entriesOn = (date) => S.entries.filter((e) => e.date === date)
  const lunchCfg = () => ({ auto: S.settings.lunch_auto, minutes: S.settings.lunch_minutes, threshold: S.settings.lunch_threshold, from: S.settings.lunch_from || null })
  const report = (month, workers = S.workers) => monthReport({ month, workers, rates: ratesBy(), entries: S.entries, offers: S.offers, bonuses: S.bonuses, today: today(), lunch: lunchCfg(), accountDays: S.accountDays })
  // Lunch rule 2 = PAID lunch added to the workers' time (8 worked hours -> lunch applies).
  // Older saved data: no lunch settings yet -> start the rule today so existing days keep their numbers;
  // rule 1 (an earlier version that deducted lunch) -> switch to rule 2 but keep its start date.
  function ensureLunch() {
    const st = S.settings
    if (st.lunch_rule === 2) return
    if (st.lunch_minutes == null) { st.lunch_auto = true; st.lunch_minutes = 60; st.lunch_from = S.entries.length ? today() : null }
    st.lunch_rule = 2; st.lunch_threshold = 8
    save(S)
  }
  ensureLunch()
  const active = () => S.workers.filter((w) => w.active)

  function schedule(month) {
    if (S.schedules[month]) return { weekdays: S.schedules[month], confirmed: true }
    const [y, m] = month.split('-').map(Number)
    const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
    return { weekdays: S.schedules[prev] || S.settings.rd_default, confirmed: false }
  }
  const workerView = (w) => { const r = ratesBy()[w.id] || []; return { ...w, rates: r, rate: rateOn(r, today()) } }

  function dayView(date) {
    const month = date.slice(0, 7), workers = active(), rep = report(month, workers), sch = schedule(month)
    const entries = entriesOn(date), rates = ratesBy(), offer = offerFor(date)
    const cov = coverage(entries.filter((e) => e.status === 'worked' || e.status === 'training'))
    const stats = evalOffers(S.offers, S.entries, rates, today()).stats
    return {
      date, month, schedule: sch, isRestDay: sch.weekdays.includes(weekday(date)),
      workers: workers.map((w) => ({
        id: w.id, name: w.name, color: w.color, rate: rateOn(rates[w.id], date), paid: isPaid(month, w.id),
        entry: entries.find((e) => e.worker_id === w.id) || null, row: rep.report[w.id].rows.find((r) => r.date === date),
      })),
      account: S.accountDays[date] || { date, company_hours: null, lunch_hours: null, note: null },
      coverage: cov,
      offer: offer && { ...offer, stats: stats[offer.id], usedHours: entries.reduce((s, e) => s + (e.ot_hours || 0), 0) },
      presets: S.settings.presets, lunchSettings: lunchCfg(),
    }
  }

  function saveDay(date, body) {
    const month = date.slice(0, 7), wmap = new Map(S.workers.map((w) => [w.id, w]))
    const input = (body.entries || []).filter((e) => e.status).map((e) => ({ ...e }))
    const seen = new Set(), existing = entriesOn(date)
    const locked = new Set(S.workers.map((w) => w.id).filter((id) => isPaid(month, id)))
    for (const e of input) {
      const w = wmap.get(+e.worker_id)
      need(w, 'Unknown worker'); need(!seen.has(w.id), 'Duplicate worker in this day'); seen.add(w.id)
      need(STATUSES.includes(e.status), 'Bad status')
      e.worker_id = w.id
      const timed = e.status === 'worked' || e.status === 'training'
      if (timed) need(toMin(e.time_in) != null && toMin(e.time_out) != null && spanMin(e.time_in, e.time_out) > 0, `${w.name}: enter a valid time in and time out`)
      else { e.time_in = null; e.time_out = null }
      e.ot_hours = num(e.ot_hours || 0, `${w.name}: OT hours`, { max: 24 })
      e.rate_override = num(e.rate_override, `${w.name}: rate override`, { nullable: true })
      if (e.rate_override != null) need(String(e.rate_override_reason || '').trim(), `${w.name}: a reason is required for a rate override`)
      else e.rate_override_reason = null
      if (e.ot_hours > 0) need(timed, `${w.name}: OT needs a worked shift`)
      if (locked.has(w.id)) {
        const cur = existing.find((x) => x.worker_id === w.id)
        const same = cur && cur.status === e.status && (cur.time_in || null) === (e.time_in || null) && (cur.time_out || null) === (e.time_out || null) && (cur.ot_hours || 0) === e.ot_hours
        if (!same) throw err(409, `${w.name}'s ${month} is marked paid and locked. Unmark it as paid to edit.`)
        e.__skip = true
      }
    }
    // locked workers that are not in the payload still count for coverage and the OT cap
    const covInput = [...input, ...existing.filter((x) => locked.has(x.worker_id) && !seen.has(x.worker_id)).map((x) => ({ ...x, __skip: true }))]
    const cov = coverage(covInput.filter((e) => e.status === 'worked' || e.status === 'training'))
    const warnings = []
    if (cov.status === 'overlap') {
      if (!body.force) throw err(409, `Two workers overlap by ${cov.overlap} minutes.`, { needsConfirm: true })
      warnings.push({ type: 'overlap', minutes: cov.overlap })
    }
    if (cov.status === 'gap') warnings.push({ type: 'gap', minutes: cov.gap })

    const otIn = covInput.filter((e) => e.ot_hours > 0)
    let offer = null
    if (otIn.length) {
      offer = offerFor(date)
      if (!offer) throw err(400, 'No OT offer covers this date, so OT cannot be entered')
      const total = otIn.reduce((s, e) => s + e.ot_hours, 0)
      if (total > offer.cap_hours + 1e-9) throw err(400, `OT is capped at ${offer.cap_hours} h per shift for "${offer.name}" (you entered ${total} h across all workers)`)
    }
    const position = body.ot_position === 'before' ? 'before' : 'after'
    const ots = deriveOT(cov, position, otIn.map((e) => e.ot_hours))
    otIn.forEach((e, i) => Object.assign(e, ots[i], { ot_position: position, ot_offer_id: offer.id }))
    const a = body.account
    if (a && a.company_hours != null && a.company_hours !== '' && cov.hours) {
      // the company shows the whole shift including the paid lunch
      const lp = lunchPlan(covInput, { ...lunchCfg(), override: a.lunch_hours, date })
      const total = cov.hours + lp.totalMin / 60
      if (Math.abs(total - Number(a.company_hours)) > 0.01) warnings.push({ type: 'mismatch', siblings: total, company: Number(a.company_hours) })
    }
    const acct = a && { date, company_hours: num(a.company_hours, 'Company hours', { nullable: true, max: 48 }), lunch_hours: num(a.lunch_hours, 'Lunch hours', { nullable: true, max: 12 }), note: a.note || null }

    // all checks passed: write
    S.entries = S.entries.filter((x) => !(x.date === date && !seen.has(x.worker_id) && !locked.has(x.worker_id)))
    for (const e of input.filter((x) => !x.__skip)) {
      const row = { ...Object.fromEntries(ENTRY_COLS.map((k) => [k, e[k] ?? null])), worker_id: e.worker_id, date, ot_hours: e.ot_hours || 0 }
      const i = S.entries.findIndex((x) => x.worker_id === e.worker_id && x.date === date)
      if (i >= 0) S.entries[i] = { ...S.entries[i], ...row }
      else S.entries.push({ id: S.seq++, ...row })
    }
    if (acct) S.accountDays[date] = acct
    save(S)
    return warnings
  }

  function offersView() {
    const rates = ratesBy(), { stats, byEntry } = evalOffers(S.offers, S.entries, rates, today())
    return [...S.offers].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((o) => {
      const es = S.entries.filter((e) => e.ot_offer_id === o.id && e.ot_hours > 0)
      const mine = (id) => { const x = es.filter((e) => e.worker_id === id); return { hours: x.reduce((s, e) => s + e.ot_hours, 0), pay: Math.round(x.reduce((s, e) => s + (byEntry[e.id]?.otPay || 0), 0) * 100) / 100 } }
      return {
        ...o, stats: stats[o.id] || { total: 0, min: o.min_hours, qualified: false, final: today() > o.end_date, remaining: o.min_hours }, active: today() <= o.end_date,
        contributions: S.workers.map((w) => ({ id: w.id, name: w.name, color: w.color, ...mine(w.id) })).filter((c) => c.hours > 0),
      }
    })
  }
  function offerBody(b, id) {
    const o = {
      name: String(b.name || '').trim(), start_date: b.start_date, end_date: b.end_date,
      cap_hours: num(b.cap_hours, 'Max OT hours per shift', { min: 0.25, max: 24 }), min_hours: num(b.min_hours, 'Minimum total OT hours'),
      qualified_rate: num(b.qualified_rate, 'Qualified rate'), below_min_rate: num(b.below_min_rate, 'Below-minimum rate', { nullable: true }),
      tier_mode: b.tier_mode === 'marginal' ? 'marginal' : 'whole', notes: b.notes || null,
    }
    need(o.name, 'Give the offer a name'); need(ISO.test(o.start_date) && ISO.test(o.end_date) && o.start_date <= o.end_date, 'Check the offer dates')
    const clash = S.offers.find((x) => x.id !== id && x.start_date <= o.end_date && x.end_date >= o.start_date)
    if (clash) throw err(409, `These dates overlap the offer "${clash.name}"`)
    const days = (Date.parse(o.end_date) - Date.parse(o.start_date)) / 864e5 + 1
    return { o, warnings: days > 14 ? [`This offer is ${days} days long. Offers are usually 14 days or less.`] : [] }
  }
  function bonusBody(b) {
    need(S.workers.some((w) => w.id === +b.worker_id), 'Choose a worker')
    need(ISO.test(b.review_date || ''), 'Enter the review date')
    const pay_month = b.pay_month || b.review_date.slice(0, 7)
    need(MONTH.test(pay_month), 'Bad pay month')
    if (isPaid(pay_month, +b.worker_id)) throw err(409, 'That month is marked paid for this worker')
    return { worker_id: +b.worker_id, review_date: b.review_date, pay_month, reference: b.reference || null, note: b.note || null, chat_time: toMin(b.chat_time) != null ? b.chat_time : null, amount: num(b.amount, 'Bonus amount', { max: 10000 }) }
  }

  const routes = []
  const on = (m, p, h) => routes.push([m, new RegExp('^' + p.replace(/:\w+/g, '([^/]+)') + '$'), h])
  const commit = (v) => { save(S); return v }

  on('GET', '/settings', () => S.settings)
  on('PUT', '/settings', ({ body: b }) => {
    if (b.presets) {
      need(Array.isArray(b.presets) && b.presets.length <= 12, 'Invalid presets')
      for (const p of b.presets) need(p.label && toMin(p.time_in) != null && toMin(p.time_out) != null, 'Each preset needs a label and two times')
      S.settings.presets = b.presets.map(({ label, time_in, time_out }) => ({ label, time_in, time_out }))
    }
    if (b.default_review_bonus != null) S.settings.default_review_bonus = num(b.default_review_bonus, 'Default review bonus')
    if (b.reminder_days != null) S.settings.reminder_days = num(b.reminder_days, 'Reminder days', { min: 1, max: 365 })
    if (b.lunch_auto != null) S.settings.lunch_auto = !!b.lunch_auto
    if (b.lunch_minutes != null) S.settings.lunch_minutes = num(b.lunch_minutes, 'Lunch minutes', { max: 240 })
    if (b.lunch_threshold != null) S.settings.lunch_threshold = num(b.lunch_threshold, 'Full shift hours', { min: 1, max: 24 })
    if ('lunch_from' in b) { need(!b.lunch_from || ISO.test(b.lunch_from), 'Bad date'); S.settings.lunch_from = b.lunch_from || null }
    if (b.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }) } catch { throw err(400, 'Unknown timezone') } S.settings.timezone = b.timezone }
    return commit(S.settings)
  })
  on('GET', '/schedule/:m', ({ params: [m] }) => { need(MONTH.test(m), 'Bad month'); return schedule(m) })
  on('PUT', '/schedule/:m', ({ params: [m], body }) => {
    need(MONTH.test(m), 'Bad month')
    const wd = body.weekdays
    need(Array.isArray(wd) && wd.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), 'Bad weekdays')
    S.schedules[m] = [...new Set(wd)].sort()
    return commit(schedule(m))
  })

  on('GET', '/workers', () => S.workers.map(workerView))
  on('POST', '/workers', ({ body }) => {
    const name = String(body.name || '').trim()
    need(name && name.length <= 40, 'Enter a worker name')
    const rate = num(body.rate, 'Hourly rate'), from = body.effective_from || '2000-01-01'
    need(ISO.test(from), 'Bad date')
    if (S.workers.some((w) => w.name.toLowerCase() === name.toLowerCase())) throw err(409, 'That name is already used')
    const w = { id: S.seq++, name, color: COLORS[S.workers.length % COLORS.length], active: true }
    S.workers.push(w); S.rates.push({ worker_id: w.id, effective_from: from, rate })
    return commit(workerView(w))
  })
  on('POST', '/workers/:id/rates', ({ params: [id], body }) => {
    const w = S.workers.find((x) => x.id === +id)
    need(w, 'Unknown worker'); need(ISO.test(body.effective_from || ''), 'Bad date')
    S.rates.push({ worker_id: w.id, effective_from: body.effective_from, rate: num(body.rate, 'Hourly rate') })
    return commit(workerView(w))
  })
  on('POST', '/workers/:id/active', ({ params: [id], body }) => {
    const w = S.workers.find((x) => x.id === +id)
    need(w, 'Unknown worker'); w.active = !!body.active
    return commit(workerView(w))
  })

  on('GET', '/day/:d', ({ params: [d] }) => { need(ISO.test(d), 'Bad date'); return dayView(d) })
  on('PUT', '/day/:d', ({ params: [d], body }) => { need(ISO.test(d), 'Bad date'); const warnings = saveDay(d, body); return { ok: true, warnings, day: dayView(d) } })

  on('GET', '/calendar/:m', ({ params: [m] }) => {
    need(MONTH.test(m), 'Bad month')
    const workers = active(), { report: rep } = report(m, workers), days = {}
    for (const d of daysInMonth(m)) days[d] = {}
    for (const w of workers) for (const r of rep[w.id].rows) days[r.date][w.id] = r.status
    return { workers: workers.map((w) => ({ id: w.id, name: w.name, color: w.color })), days, today: today(), weekdays: schedule(m).weekdays }
  })
  on('GET', '/summary/:m', ({ params: [month] }) => {
    need(MONTH.test(month), 'Bad month')
    const { report: rep, stats } = report(month)
    const rows = S.workers.filter((w) => w.active || rep[w.id].total > 0).map((w) => {
      const { rows: _r, bonuses: _b, ...t } = rep[w.id]
      return { worker: { id: w.id, name: w.name, color: w.color, active: w.active }, ...t, paidAt: S.paid[`${month}|${w.id}`] || null }
    })
    const sum = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100
    return {
      month, rows, notLogged: rows.reduce((s, r) => s + r.notLogged, 0),
      totals: { regularHours: sum('regularHours'), otHours: sum('otHours'), regularPay: sum('regularPay'), otPay: sum('otPay'), bonusTotal: sum('bonusTotal'), total: sum('total') },
      offers: S.offers.filter((o) => o.start_date.slice(0, 7) <= month && o.end_date.slice(0, 7) >= month).map((o) => ({ ...o, stats: stats[o.id] })),
    }
  })
  on('PUT', '/paid/:m/:w', ({ params: [month, wid], body }) => {
    need(MONTH.test(month) && S.workers.some((w) => w.id === +wid), 'Bad request')
    if (body.paid) {
      const open = S.offers.find((o) => o.start_date.slice(0, 7) <= month && o.end_date.slice(0, 7) >= month && o.end_date >= today() && S.entries.some((e) => e.ot_offer_id === o.id && e.worker_id === +wid && e.date.startsWith(month)))
      if (open) throw err(409, `"${open.name}" is still running, so OT pay is provisional. Mark paid after ${open.end_date}.`)
      S.paid[`${month}|${wid}`] = new Date().toISOString()
    } else delete S.paid[`${month}|${wid}`]
    return commit({ ok: true })
  })

  on('GET', '/offers', () => offersView())
  on('POST', '/offers', ({ body }) => { const { o, warnings } = offerBody(body); const row = { id: S.seq++, ...o }; S.offers.push(row); return commit({ id: row.id, warnings }) })
  on('PUT', '/offers/:id', ({ params: [id], body }) => {
    const i = S.offers.findIndex((o) => o.id === +id)
    need(i >= 0, 'Not found')
    const { o, warnings } = offerBody(body, +id)
    S.offers[i] = { id: +id, ...o }
    return commit({ id: +id, warnings })
  })
  on('DELETE', '/offers/:id', ({ params: [id] }) => {
    if (S.entries.some((e) => e.ot_offer_id === +id && e.ot_hours > 0)) throw err(409, 'This offer already has OT entries and cannot be deleted')
    S.offers = S.offers.filter((o) => o.id !== +id)
    return commit({ ok: true })
  })

  on('GET', '/bonuses', ({ query }) => {
    need(MONTH.test(query.month || ''), 'Bad month')
    return S.bonuses.filter((b) => b.pay_month === query.month).map((b) => { const w = S.workers.find((x) => x.id === b.worker_id); return { ...b, worker_name: w?.name, color: w?.color } })
      .sort((a, b) => b.review_date.localeCompare(a.review_date) || b.id - a.id)
  })
  on('GET', '/covered', ({ query: { date, time } }) => {
    const t = toMin(time)
    need(ISO.test(date || '') && t != null, 'Bad request')
    return entriesOn(date).filter((e) => (e.status === 'worked' || e.status === 'training') && (t - toMin(e.time_in) + 1440) % 1440 < spanMin(e.time_in, e.time_out))
      .map((e) => ({ id: e.worker_id, name: S.workers.find((w) => w.id === e.worker_id)?.name }))
  })
  on('POST', '/bonuses', ({ body }) => { const row = { id: S.seq++, ...bonusBody(body) }; S.bonuses.push(row); return commit({ id: row.id }) })
  on('PUT', '/bonuses/:id', ({ params: [id], body }) => {
    const i = S.bonuses.findIndex((b) => b.id === +id)
    need(i >= 0, 'Not found')
    if (isPaid(S.bonuses[i].pay_month, S.bonuses[i].worker_id)) throw err(409, 'That month is marked paid')
    S.bonuses[i] = { id: +id, ...bonusBody(body) }
    return commit({ ok: true })
  })
  on('DELETE', '/bonuses/:id', ({ params: [id] }) => {
    const old = S.bonuses.find((b) => b.id === +id)
    if (old && isPaid(old.pay_month, old.worker_id)) throw err(409, 'That month is marked paid')
    S.bonuses = S.bonuses.filter((b) => b.id !== +id)
    return commit({ ok: true })
  })

  on('POST', '/parse', ({ body }) => parseNotes(String(body.text || '').slice(0, 20000), active(), Number(body.year) || +today().slice(0, 4)))
  on('POST', '/apply-notes', ({ body }) => {
    const items = (body.items || []).filter((i) => i.ok), byDate = {}
    for (const i of items) (byDate[i.date] ||= []).push(i)
    let saved = 0
    for (const [date, list] of Object.entries(byDate)) {
      const cur = entriesOn(date).filter((e) => !list.some((i) => i.worker_id === e.worker_id))
      const entries = [...cur.map((e) => ({ ...e })), ...list.map((i) => ({ worker_id: i.worker_id, status: i.status, time_in: i.time_in, time_out: i.time_out, ot_hours: i.ot_hours || 0 }))]
      saveDay(date, { entries, force: true })
      saved += list.length
    }
    return { saved }
  })
  on('GET', '/meta', () => ({
    hasData: S.entries.length + S.bonuses.length > 0, lastBackupAt: S.lastBackupAt, reminderDays: S.settings.reminder_days,
    counts: { workers: S.workers.length, entries: S.entries.length, bonuses: S.bonuses.length, offers: S.offers.length },
  }))

  return {
    state: S,
    async handle(method, url, body) {
      const [path, qs] = url.split('?'), query = Object.fromEntries(new URLSearchParams(qs || ''))
      for (const [m, re, h] of routes) {
        if (m !== method) continue
        const x = re.exec(path)
        if (x) return structuredClone(h({ params: x.slice(1), body: body ?? {}, query }))
      }
      throw err(404, 'Not found')
    },
    // data for the Excel builder
    exportCtx(month, workerIds) {
      const workers = S.workers.filter((w) => (workerIds ? workerIds.includes(w.id) : w.active))
      return structuredClone({
        month, workers, rates: ratesBy(), entries: S.entries, offers: S.offers, bonuses: S.bonuses, today: today(),
        paid: Object.fromEntries(workers.filter((w) => S.paid[`${month}|${w.id}`]).map((w) => [w.id, S.paid[`${month}|${w.id}`]])),
        accountDays: S.accountDays, lunch: lunchCfg(),
      })
    },
    backup() {
      S.lastBackupAt = new Date().toISOString(); save(S)
      return { filename: `work-hours-backup-${S.lastBackupAt.slice(0, 10)}.json`, json: JSON.stringify({ app: APP_ID, version: 1, exported_at: S.lastBackupAt, data: S }, null, 1) }
    },
    restore(text) {
      let o
      try { o = JSON.parse(text) } catch { throw err(400, 'That file is not a valid backup') }
      const d = o?.data
      if (o?.app !== APP_ID || !d || !['workers', 'rates', 'entries', 'offers', 'bonuses'].every((k) => Array.isArray(d[k])) || typeof d.settings !== 'object')
        throw err(400, 'That file is not a Work Hours & Payout backup')
      for (const k of Object.keys(S)) delete S[k]
      Object.assign(S, EMPTY(), d)
      ensureLunch()
      save(S)
      return { entries: S.entries.length }
    },
    reset() { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, EMPTY(), { settings: { ...EMPTY().settings } }); save(S) },
    loadDemo() {
      need(S.entries.length === 0 && S.workers.length === 0, 'Sample data can only be loaded into an empty app')
      const ids = {}
      for (const [n, c] of [['Alex', COLORS[0]], ['Bo', COLORS[1]], ['Jo', COLORS[2]], ['Sam', COLORS[3]]]) {
        const w = { id: S.seq++, name: n, color: c, active: true }; S.workers.push(w); S.rates.push({ worker_id: w.id, effective_from: '2026-01-01', rate: 5 }); ids[n] = w.id
      }
      S.schedules['2026-10'] = [2, 3, 4]
      const d = (n) => `2026-10-${String(n).padStart(2, '0')}`
      const add = (w, n, status, a, b, rate, why) => S.entries.push({ id: S.seq++, worker_id: ids[w], date: d(n), status, time_in: a || null, time_out: b || null, ot_hours: 0, ot_start: null, ot_end: null, ot_position: null, ot_offer_id: null, rate_override: rate ?? null, rate_override_reason: why ?? null, remark: null })
      ;[1, 6, 7, 8, 13, 14, 15, 20, 21, 22, 27, 28, 29].forEach((n) => add('Alex', n, 'rd'))
      ;[[4, '16:00', '20:30'], [10, '20:30', '01:00'], [11, '20:30', '01:00'], [17, '20:30', '01:00'], [18, '16:00', '20:30'], [25, '20:30', '01:00']].forEach(([n, a, b]) => add('Alex', n, 'worked', a, b))
      add('Alex', 31, 'worked', '16:00', '17:20', 5.5, 'Rate shown on the original sheet')
      ;[6, 7, 8, 13, 14, 15, 20, 21, 22, 27, 28, 29].forEach((n) => add('Bo', n, 'rd'))
      ;[[17, '16:00', '20:30'], [24, '20:30', '01:00'], [25, '16:00', '20:30']].forEach(([n, a, b]) => add('Bo', n, 'worked', a, b))
      add('Bo', 31, 'worked', '21:00', '02:20', 5.5, 'Rate shown on the original sheet')
      save(S)
    },
    meta: () => structuredClone({ hasData: S.entries.length + S.bonuses.length > 0, lastBackupAt: S.lastBackupAt, reminderDays: S.settings.reminder_days }),
  }
}
