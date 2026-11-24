import React, { useEffect, useRef, useState } from 'react'
import { api, useLoad, useToast, $, peso, h2, addDays, fmtDate } from './lib.js'
import { Page, Icon, Avatar, Metric, Field, Loading, ErrorBox, StatusLabel, useShell } from './ui.jsx'
import { spanMin, toMin, coverage, deriveOT, fmtMin, lunchPlan, paidHours } from '../../shared/calc.js'
import { parseHours, parseDateInput } from '../../shared/input.js'
import { useSyncStatus, canManage } from './family.jsx'

export const T = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const short = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')}` }
export const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') + 'm' : ''}` }
const hourLabel = (min) => { const t = fmtMin(min), [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}` }
const blank = { time_in: '', time_out: '', ot_hours: '', lunch_min: '', rate_override: '', rate_override_reason: '', remark: '' }
const STATUS_LABEL = { worked: 'Worked', rd: 'RD', not_worked: 'Not worked', training: 'Training', rdot: 'RD OT' }
export const isTimed = (f) => f.status === 'worked' || f.status === 'training'

export function useDay(date) {
  const toast = useToast()
  const { data: day, loading, error, reload, stale } = useLoad(`/day/${date}`, { live: false })
  const [form, setFormRaw] = useState(null)
  const [touched, setTouched] = useState(false)
  const setForm = (f) => { setTouched(true); setFormRaw(f) }
  // another phone changed data: reload right away unless the user is in the middle of editing this day
  useEffect(() => { if (stale && !touched) reload() }, [stale, touched, reload])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!day) return
    const w = {}
    for (const x of day.workers) {
      const e = x.entry
      w[x.id] = e
        ? { status: e.status, time_in: e.time_in || '', time_out: e.time_out || '', ot_hours: e.status === 'rdot' ? '' : e.ot_hours || '', lunch_min: e.lunch_min ?? '', rate_override: e.rate_override ?? '', rate_override_reason: e.rate_override_reason || '', remark: e.remark || '' }
        : { ...blank, status: day.isRestDay ? 'rd' : '', suggested: day.isRestDay }
    }
    setTouched(false)
    setFormRaw({ w, ot_position: day.workers.find((x) => x.entry?.ot_position)?.entry.ot_position || 'after',
      account: { company_hours: day.account.company_hours ?? '', lunch_hours: day.account.lunch_hours ?? '', note: day.account.note || '', day_off: day.account.day_off || null } })
  }, [day])
  const ready = !!(day && form && day.date === date)
  const setW = (id, p) => setForm((f) => ({ ...f, w: { ...f.w, [id]: { ...f.w[id], ...p } } }))
  const cov = ready ? coverage(day.workers.filter((w) => isTimed(form.w[w.id])).map((w) => ({ ...form.w[w.id] }))) : null
  const lunchOf = (override) => lunchPlan(day.workers.map((w) => ({ ...form.w[w.id] })), { ...day.lunchSettings, override, date })
  const plan = ready ? lunchOf(form.account.lunch_hours) : null
  const autoPlan = ready ? lunchOf('') : null
  const [hoursDraft, setHoursDraft] = useState({})
  // type "4" or "4:30" instead of picking times: the block starts where the others end (or at the usual shift start)
  const typeHours = (id, text) => {
    setHoursDraft((h) => ({ ...h, [id]: text }))
    const h = parseHours(text), f = form.w[id]
    if (h == null || h <= 0) return
    let start = f.time_in
    if (!start) {
      const others = day.workers.filter((w) => w.id !== id && isTimed(form.w[w.id]) && form.w[w.id].time_in && form.w[w.id].time_out).map((w) => ({ ...form.w[w.id] }))
      const c = coverage(others)
      start = c.start != null ? fmtMin(c.end) : day.shiftStart
    }
    setW(id, { time_in: start, time_out: fmtMin(toMin(start) + Math.round(h * 60)) })
  }
  const endHours = (id) => setHoursDraft((h) => ({ ...h, [id]: undefined }))

  async function save(force = false) {
    setSaving(true)
    // send blocks in time order so OT slices follow the same order
    const order = (f) => (isTimed(f) && cov?.start != null ? (toMin(f.time_in) - cov.start + 1440) % 1440 : 9999)
    const entries = day.workers.filter((w) => form.w[w.id].status).map((w) => {
      const x = form.w[w.id]
      return { worker_id: w.id, status: x.status, time_in: x.time_in || null, time_out: x.time_out || null, ot_hours: x.ot_hours === '' ? 0 : Number(x.ot_hours), lunch_min: x.lunch_min === '' || x.lunch_min == null ? null : Number(x.lunch_min),
        rate_override: x.rate_override === '' ? null : Number(x.rate_override), rate_override_reason: x.rate_override_reason, remark: x.remark || null, _o: order(x) }
    }).sort((a, b) => a._o - b._o).map(({ _o, ...e }) => e)
    try {
      const r = await api(`/day/${date}`, { method: 'PUT', body: { entries, force, ot_position: form.ot_position, account: form.account } })
      const notes = r.warnings.map((x) => x.type === 'gap' ? `${x.minutes} min gap in coverage` : x.type === 'overlap' ? `${x.minutes} min overlap`
        : x.type === 'shift' ? `logged ${hm(x.logged / 60)} but the shift is ${hm(x.shift / 60)}` : `Workers total ${h2(x.siblings)} h, company shows ${h2(x.company)} h`)
      toast(notes.length ? 'Saved. Check: ' + notes.join('; ') : 'Daily log saved', notes.length ? 'error' : 'ok')
      reload()
    } catch (e) {
      if (e.data?.needsConfirm && window.confirm(e.message + ' Save anyway?')) return save(true)
      toast(e.message, 'error')
    } finally { setSaving(false) }
  }
  return { day, form, setForm, setW, ready, loading, error, reload, save, saving, cov, plan, autoPlan, hoursDraft, typeHours, endHours, stale: stale && touched }
}

export function DayNav({ date, setDate, today }) {
  const toast = useToast()
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const picker = useRef(null)
  const commit = () => {
    const iso = parseDateInput(text, date)
    if (iso) setDate(iso)
    else if (text.trim()) toast('Could not read that date. Try 11/7, nov 7 or just 7.', 'error')
    setTyping(false)
  }
  return (
    <div className="date-navigator">
      <button className="icon-button" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><Icon name="arrow" size={18} /></button>
      <div className="date-pick">
        {typing
          ? <input className="date-type" autoFocus placeholder="11/7, nov 7 or 7" aria-label="Type a date" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(''); setTyping(false) } }} />
          : <button className="date-text" aria-label="Type a date" onClick={() => { setText(''); setTyping(true) }}><span>{date === today ? 'Today' : fmtDate(date, { weekday: 'long' })}</span><strong>{fmtDate(date, { month: 'long', day: 'numeric', year: 'numeric' })}</strong></button>}
      </div>
      <button className="icon-button" aria-label="Pick from the calendar" onClick={() => (picker.current?.showPicker ? picker.current.showPicker() : picker.current?.click())}><Icon name="calendar" size={18} /></button>
      <input ref={picker} className="date-hidden" type="date" tabIndex={-1} aria-hidden="true" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      <button className="icon-button next" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><Icon name="arrow" size={18} /></button>
    </div>
  )
}

export function DailyLog({ date, setDate, today }) {
  const { go } = useShell()
  const d = useDay(date)
  const [custom, setCustom] = useState({})
  const [more, setMore] = useState({})
  const toast = useToast()   // hooks must run before the early returns below
  const manage = canManage(useSyncStatus())   // members can add new logs, not change saved ones
  const [hoursOnly, setHoursOnlyRaw] = useState(() => { try { return localStorage.getItem('wh-hours-only') === '1' } catch { return false } })
  const setHoursOnly = (v) => { setHoursOnlyRaw(v); try { localStorage.setItem('wh-hours-only', v ? '1' : '0') } catch { /* ignore */ } }
  const eyebrow = fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })
  if (d.error) return <Page title="Daily Log" eyebrow={eyebrow}><ErrorBox error={d.error} /></Page>
  if (!d.ready) return <Page title="Daily Log" eyebrow={eyebrow}><Loading /></Page>
  const { day, form, setW, setForm, plan, hoursDraft, typeHours, endHours } = d
  const rows = day.workers.map((w) => ({ w, f: form.w[w.id] }))
  const logged = rows.filter((r) => r.f.status).length
  const regH = rows.reduce((s, r) => s + (r.f.status === 'rdot' ? 0 : paidHours(r.f, plan)), 0)
  const otH = rows.reduce((s, r) => s + (r.f.status === 'rdot' ? (r.f.time_in && r.f.time_out ? spanMin(r.f.time_in, r.f.time_out) / 60 : 0) : Number(r.f.ot_hours) || 0), 0)
  const saveCap = (v) => {
    const hours = v === '' || Number(v) === Number(day.offer.cap_hours) ? '' : v
    api(`/offers/${day.offer.id}/day-cap`, { method: 'PUT', body: { date, hours } }).then(() => { toast('OT availability saved for this day'); d.reload() }).catch((e) => toast(e.message, 'error'))
  }
  const n = rows.length
  const owner = day.workers.find((w) => w.owner)
  // paid regular time vs the shift (work hours + the paid lunch, however the day was written down)
  const covered = Math.round(regH * 60)
  const leave = form.account.day_off === 'leave'
  const savedLocked = !manage && day.workers.some((w) => w.entry)          // a member can't change what's already saved
  const setLeave = (on) => setForm({ ...form, account: { ...form.account, day_off: on ? 'leave' : null }, w: on ? Object.fromEntries(Object.entries(form.w).map(([k, v]) => [k, { ...v, status: v.status === 'worked' || v.status === 'training' || v.status === 'rdot' ? '' : v.status }])) : form.w })
  // lunch split presets: equal (automatic), all to the owner, or custom minutes per person
  const lunchMode = owner && Number(form.w[owner.id]?.lunch_min) >= plan.poolMin - 0.01 && plan.poolMin > 0 ? 'owner' : rows.some((r) => r.f.lunch_min !== '' && r.f.lunch_min != null) ? 'custom' : 'equal'
  const setLunch = (mode) => setForm({ ...form, w: Object.fromEntries(Object.entries(form.w).map(([k, v]) => {
    if (mode === 'owner' && owner && k === String(owner.id)) return [k, { ...v, status: v.status || 'not_worked', lunch_min: String(Math.round(plan.poolMin)) }]
    if (mode === 'custom') return [k, isTimed(v) ? { ...v, lunch_min: String(Math.round(plan.minFor(v) * 10) / 10) } : v]
    return [k, { ...v, lunch_min: '' }]
  })) })
  return (
    <>
      <Page title="Daily Log" eyebrow={eyebrow} narrow={false} className="daily-page">
        {d.stale && <div className="alert-banner"><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>Changed on another phone</strong><p>Someone in the organization updated this day while you were editing.</p></div><button onClick={d.reload}>Load theirs</button></div>}
        <DayNav date={date} setDate={setDate} today={today} />
        <section className="overview-card">
          <div className="overview-title"><div><p className="eyebrow">Account shift · {T(day.shift.start)} – {T(day.shift.end)}</p><h2>{leave ? 'Leave · no work' : day.isRestDay ? 'Rest day' : 'Shift coverage'}</h2></div>
            {!leave && !day.isRestDay && <span className="completion">{hm(covered / 60) || '0h'} / {hm(day.shift.minutes / 60)}</span>}</div>
          <div className="metric-row">
            <Metric label="Paid hours" value={hm(regH) || '0h'} />
            <Metric label="Overtime" value={otH ? hm(otH) : '0h'} />
            <Metric label="Workers" value={`${rows.filter((r) => isTimed(r.f) || r.f.status === 'rdot').length}`} />
          </div>
          {!leave && !day.isRestDay && <div className="progress-track"><span style={{ width: `${Math.min(100, (covered / (day.shift.minutes || 1)) * 100)}%` }} /></div>}
          <div className="pill-row" style={{ marginTop: 12 }}>
            <button className="outline-button" onClick={() => setHoursOnly(!hoursOnly)}>{hoursOnly ? 'Enter times instead' : 'Enter hours only'}</button>
            {!day.isRestDay && !savedLocked && <button className="outline-button" onClick={() => setLeave(!leave)}>{leave ? 'Not leave — log work' : 'Mark as leave (no work)'}</button>}
          </div>
        </section>
        {!leave && !day.isRestDay && covered > 0 && Math.abs(covered - day.shift.minutes) > 1 && plan.inside && (
          <div className="alert-banner"><span className="alert-icon"><Icon name="alert" size={19} /></span>
            <div><strong>{covered < day.shift.minutes ? `${hm((day.shift.minutes - covered) / 60)} of the shift not logged yet` : `${hm((covered - day.shift.minutes) / 60)} more than the shift`}</strong><p>The shift is {T(day.shift.start)} – {T(day.shift.end)}: {hm((day.shift.minutes - plan.poolMin) / 60)} of work + {Math.round(plan.poolMin)} min paid lunch. Enter the work hours (e.g. 4h + 4h), or times that include the lunch (4:00–8:30 + 8:30–1:00).</p></div></div>
        )}
        {leave && <div className="info-card"><Icon name="calendar" size={18} /><div><strong>Leave day</strong><p>The account did not work today, so nobody is paid for it. Save to keep it marked.</p></div></div>}
        {day.isRestDay && <div className="info-card"><Icon name="calendar" size={18} /><div><strong>Scheduled rest day</strong><p>Matches this month’s rest-day schedule{day.schedule.confirmed ? '' : ' (suggested from last month; confirm it in Settings)'}. If OT was offered, mark who did it as “RD OT”.</p></div></div>}
        {(day.offer || otH > 0) && (() => { const p = day.otPool, pct = p.min ? Math.min(100, ((p.total) / p.min) * 100) : 100; return (
          <div className="info-card"><Icon name="briefcase" size={18} /><div><strong>{p.kind === 'offer' ? `OT offer · ${p.name}` : `OT this month${day.offer ? ` · ${day.offer.name}` : ''}`}</strong>
            <p>{p.kind === 'month' && !p.minSet ? `This month’s OT minimum isn’t set yet, so OT shows at ${$(p.rate)}/h. Set it in Settings once the company says it (0 if none).` : !p.min ? `No minimum: OT is paid at ${$(p.rate)}/h.` : p.qualified ? `Minimum reached (${h2(p.total)} of ${p.min}h, everyone together): every OT hour is paid ${$(p.rate)}/h.`
              : p.final ? `Only ${h2(p.total)} of ${p.min}h was reached, so OT ${p.kind === 'offer' ? 'in this offer' : 'this month'} is paid at the regular rate.`
              : `${h2(p.total)} of ${p.min}h so far, everyone together. Shown at ${$(p.rate)}/h for now; if ${h2(p.remaining)}h more isn’t reached by the end of the ${p.kind === 'offer' ? 'offer' : 'month'}, all of it drops to the regular rate.`}</p>
            {p.min > 0 && <div className="progress-track" style={{ marginTop: 8 }}><span style={{ width: pct + '%' }} /></div>}
            {day.offer && day.offer.cap_today != null && <div className="form-grid" style={{ marginTop: 10, maxWidth: 260 }}><Field label="OT available today (hours)"><input disabled={!manage} type="number" min="0.25" step="0.25" key={date + ':' + day.offer.cap_today} defaultValue={day.offer.cap_today} onBlur={(e) => e.target.value !== String(day.offer.cap_today) && saveCap(e.target.value)} /></Field></div>}</div></div>) })()}
        {!leave && plan.inside && plan.poolMin > 0 && (
          <div className="info-card"><Icon name="clock" size={18} /><div><strong>Paid lunch ({Math.round(plan.poolMin)} min)</strong>
            <p>{lunchMode === 'owner' ? `Goes to ${owner.name} (calls during lunch).` : lunchMode === 'custom' ? 'Split by the minutes you set for each person below.' : `Shared equally: +${Math.round(plan.perMin * 10) / 10} min each.`}{plan.insideMin > 0.5 ? ' The times entered already include the lunch, so that part is taken out of everyone’s time first.' : ''}</p>
            <div className="pill-row" style={{ marginTop: 8 }}>
              <button disabled={savedLocked} className={`outline-button ${lunchMode === 'equal' ? 'active' : ''}`} onClick={() => setLunch('equal')}>Equal</button>
              {owner && <button disabled={savedLocked} className={`outline-button ${lunchMode === 'owner' ? 'active' : ''}`} onClick={() => setLunch('owner')}>All to {owner.name}</button>}
              <button disabled={savedLocked} className={`outline-button ${lunchMode === 'custom' ? 'active' : ''}`} onClick={() => { setLunch('custom'); setMore(Object.fromEntries(rows.map((r) => [r.w.id, true]))) }}>Custom</button>
            </div>
            {plan.overGiven && <p className="warning-text" style={{ marginTop: 6 }}>More lunch given out ({Math.round(plan.givenMin)} min) than the {Math.round(plan.poolMin)} min there is.</p>}</div></div>
        )}
        {!plan.inside && plan.totalMin > 0 && <div className="info-card"><Icon name="clock" size={18} /><div><strong>Paid lunch added</strong><p>{Math.round(plan.totalMin * 10) / 10} min of paid lunch added on top of the logged times (the older rule, used for days before {day.lunchSettings.insideFrom || 'the switch'}).</p></div></div>}
        {!leave && <><div className="section-heading"><div><h2>Who worked</h2><p>{hoursOnly ? 'Type each person’s hours; times are filled in from the shift start, in order.' : 'Pick each person’s part of the shift. Times include the lunch hour.'}</p></div><span className="live-dot">Live totals</span></div>
        <div className="worker-grid">
          {rows.map(({ w, f }) => {
            const timed = isTimed(f), rdot = f.status === 'rdot', saved = !manage && !!w.entry, off = w.paid || saved
            const hrs = (timed || rdot) && f.time_in && f.time_out ? spanMin(f.time_in, f.time_out) / 60 : 0
            const paid = rdot ? 0 : paidHours(f, plan), lunchMin = rdot ? 0 : plan.minFor(f), lunchOut = rdot ? 0 : plan.deductFor(f)
            const rate = f.rate_override !== '' ? Number(f.rate_override) : w.rate
            const match = day.presets.some((p) => p.time_in === f.time_in && p.time_out === f.time_out)
            const showCustom = rdot || custom[w.id] || (f.time_in && !match)
            const hoursValue = hoursDraft[w.id] ?? (hrs > 0 ? String(Math.round(hrs * 100) / 100) : '')
            const showMore = more[w.id] || f.rate_override !== '' || f.remark || f.lunch_min !== ''
            const statuses = Object.entries(STATUS_LABEL).filter(([s]) => s !== 'rdot' || day.isRestDay || day.offer || f.status === 'rdot')
            return (
              <article className={`worker-card ${!f.status ? 'unlogged' : ''}`} key={w.id}>
                <div className="worker-head">
                  <div className="worker-identity"><Avatar w={w} /><div><h3>{w.name}</h3><p>{f.status ? STATUS_LABEL[f.status] + (f.suggested ? ' (suggested)' : '') : 'Not logged yet'}</p></div></div>
                  {f.status && <StatusLabel s={f.status}><Icon name="check" size={13} />{STATUS_LABEL[f.status]}</StatusLabel>}
                </div>
                <div className="status-control" style={statuses.length > 4 ? { gridTemplateColumns: `repeat(${statuses.length}, 1fr)` } : undefined}>
                  {statuses.map(([s, l]) => <button key={s} disabled={off} className={f.status === s ? 'active' : ''} onClick={() => setW(w.id, { status: s, suggested: false })}>{l}</button>)}
                </div>
                {(timed || rdot) && (
                  <div className="shift-details">
                    {!rdot && !hoursOnly && (
                      <>
                        <p className="field-label">Shift preset</p>
                        <div className="preset-row">
                          {day.presets.map((p) => <button key={p.label} disabled={off} className={`preset ${f.time_in === p.time_in && f.time_out === p.time_out ? 'active' : ''}`} onClick={() => setW(w.id, { time_in: p.time_in, time_out: p.time_out })}><span>{p.label}</span><strong>{T(p.time_in)} – {T(p.time_out)}</strong></button>)}
                          <button className="add-preset" aria-label="Custom time" onClick={() => setCustom({ ...custom, [w.id]: !custom[w.id] })}><Icon name="plus" size={18} /></button>
                        </div>
                      </>
                    )}
                    <div className="form-grid" style={{ marginTop: rdot || hoursOnly ? 0 : 12 }}>
                      <Field label={hoursOnly ? 'Hours' : 'Or just type the hours'}><input inputMode="decimal" placeholder="e.g. 4 or 4:30" disabled={off} value={hoursValue} onChange={(e) => typeHours(w.id, e.target.value)} onBlur={() => endHours(w.id)} /></Field>
                      <div className="hours-range"><span className="field-label">Time</span><strong>{f.time_in && f.time_out ? `${T(f.time_in)} – ${T(f.time_out)}` : '—'}</strong></div>
                    </div>
                    {showCustom && !hoursOnly && <div className="form-grid">
                      <Field label="Time in"><input type="time" disabled={off} value={f.time_in} onChange={(e) => setW(w.id, { time_in: e.target.value })} /></Field>
                      <Field label="Time out"><input type="time" disabled={off} value={f.time_out} onChange={(e) => setW(w.id, { time_out: e.target.value })} /></Field>
                    </div>}
                    {rdot ? (
                      <>
                        <div className="calculation"><span><Icon name="clock" size={16} /> Rest-day OT</span><strong>{hrs > 0 ? hm(hrs) : '—'}</strong></div>
                        <p className="muted-text" style={{ marginTop: 6 }}>All of it is OT. Counts toward {day.otPool.kind === 'offer' ? 'the offer’s' : 'the month’s'} OT minimum; paid {$(day.otPool.rate)}/h once it is reached, otherwise the regular rate.</p>
                      </>
                    ) : (
                      <>
                        <div className="calculation"><span><Icon name="clock" size={16} /> Paid time</span><strong>{hrs > 0 ? `${hm(paid)} · ${$(paid * rate)}${day.phpRate ? ` · ${peso(paid * rate, day.phpRate)}` : ''}` : '—'}</strong></div>
                        {hrs > 0 && (lunchMin > 0 || lunchOut > 0) && <p className="muted-text" style={{ marginTop: 6 }}>{plan.inside
                          ? `${hm(hrs)}${lunchOut > 0.05 ? ` − ${Math.round(lunchOut * 10) / 10} min lunch already in the times` : ' worked'} + ${Math.round(lunchMin * 10) / 10} min lunch${f.lunch_min !== '' ? ' (set by hand)' : ''}`
                          : `${hm(hrs)} worked + ${Math.round(lunchMin * 10) / 10} min paid lunch${f.lunch_min !== '' ? ' (given by hand)' : ' share'}`}</p>}
                        {Number(f.ot_hours) > 0 && <div className="ot-inline"><div><span>OT</span><strong>{form.ot_position === 'before' ? 'Before' : 'After'} shift · {hm(Number(f.ot_hours))}</strong></div><span className="provisional">{day.otPool.final ? 'Final' : 'Provisional'}</span></div>}
                        <div style={{ marginTop: 10 }}><Field label={`OT hours after the shift${day.offer?.cap_today != null ? ` (up to ${day.offer.cap_today}h today)` : ''}`}><input type="number" min="0" step="0.25" disabled={off} value={f.ot_hours} onChange={(e) => setW(w.id, { ot_hours: e.target.value })} /></Field></div>
                        <button className="text-button" style={{ padding: '10px 0 0' }} onClick={() => setMore({ ...more, [w.id]: !more[w.id] })}>{showMore ? 'Hide' : 'Add'} paid lunch / rate override / remark</button>
                        {showMore && <>
                          <div className="form-grid three">
                            <Field label="Rate override ($/h)"><input type="number" step="0.01" min="0" disabled={off} value={f.rate_override} placeholder={String(w.rate)} onChange={(e) => setW(w.id, { rate_override: e.target.value })} /></Field>
                            <Field label="Reason (required)"><input disabled={off} value={f.rate_override_reason} onChange={(e) => setW(w.id, { rate_override_reason: e.target.value })} /></Field>
                            <Field label="Remark"><input disabled={off} value={f.remark} onChange={(e) => setW(w.id, { remark: e.target.value })} /></Field>
                          </div>
                          <div className="form-grid"><Field label="Lunch share (minutes, blank = equal share)"><input type="number" min="0" step="5" disabled={off} placeholder={String(Math.round(plan.perMin * 10) / 10)} value={f.lunch_min} onChange={(e) => setW(w.id, { lunch_min: e.target.value })} /></Field></div>
                        </>}
                      </>
                    )}
                  </div>
                )}
                {(f.status === 'rd' || f.status === 'not_worked') && (
                  <>
                    <div className="status-note"><Icon name="calendar" size={18} /><div><strong>{f.status === 'rd' ? 'Rest day' : 'Not worked'}</strong><p>No shift hours for this day.{w.owner ? ' Can still get the lunch hour (calls).' : ''}</p></div></div>
                    <div className="form-grid">
                      <Field label="Lunch given (minutes, optional)"><input type="number" min="0" step="5" disabled={off} placeholder="0" value={f.lunch_min} onChange={(e) => setW(w.id, { lunch_min: e.target.value })} /></Field>
                      {Number(f.lunch_min) > 0 && <div className="hours-range"><span className="field-label">Paid</span><strong>{hm(Number(f.lunch_min) / 60)} · {$((Number(f.lunch_min) / 60) * rate)}</strong></div>}
                    </div>
                  </>
                )}
                {f.status === 'training' && <div className="status-note training" style={{ marginTop: 10 }}><Icon name="briefcase" size={18} /><div><strong>Paid training</strong><p>Training hours are paid at the regular rate.</p></div></div>}
                {!f.status && <button className="quick-worked" disabled={off} onClick={() => setW(w.id, { status: 'worked' })}><Icon name="plus" size={17} /> Start logging</button>}
                {w.paid && <p className="muted-text" style={{ marginTop: 10 }}><Icon name="lock" size={13} /> This month is marked paid, so {w.name}’s entries are locked.</p>}
                {!w.paid && saved && <p className="muted-text" style={{ marginTop: 10 }}><Icon name="lock" size={13} /> Saved. Only the organization owner can change it — tell them if something is wrong.</p>}
              </article>
            )
          })}
        </div></>}
      </Page>
      <div className="sticky-actions">
        <button className="secondary-button" onClick={() => go('account')}><Icon name="clock" size={18} /> Split shift</button>
        <button className="secondary-button" onClick={() => go('bonuses')}><Icon name="gift" size={18} /> Review +</button>
        <button className="primary-button" disabled={d.saving} onClick={() => d.save()}><Icon name="check" size={18} /> {d.saving ? 'Saving…' : 'Save day'}</button>
      </div>
    </>
  )
}

export function AccountDay({ date, setDate, today }) {
  const d = useDay(date)
  const [edit, setEdit] = useState(null)
  const [adding, setAdding] = useState(false)
  const toast = useToast()   // hooks must run before the early returns below
  const eyebrow = 'Shift coverage'
  if (d.error) return <Page title="Account Day" eyebrow={eyebrow}><ErrorBox error={d.error} /></Page>
  if (!d.ready) return <Page title="Account Day" eyebrow={eyebrow}><Loading /></Page>
  const { day, form, setW, setForm, cov, plan, autoPlan, hoursDraft, typeHours, endHours } = d
  const saveCap = (v) => {
    const hours = v === '' || Number(v) === Number(day.offer.cap_hours) ? '' : v
    api(`/offers/${day.offer.id}/day-cap`, { method: 'PUT', body: { date, hours } }).then(() => { toast('OT availability saved for this day'); d.reload() }).catch((e) => toast(e.message, 'error'))
  }
  const timedRows = day.workers.filter((w) => isTimed(form.w[w.id]) && spanMin(form.w[w.id].time_in, form.w[w.id].time_out) > 0)
    .map((w) => ({ w, f: form.w[w.id], ns: cov.start != null ? (toMin(form.w[w.id].time_in) - cov.start + 1440) % 1440 : 0, dur: spanMin(form.w[w.id].time_in, form.w[w.id].time_out) })).sort((a, b) => a.ns - b.ns)
  const win = cov.start != null ? cov.end - cov.start : 0
  const unassigned = day.workers.filter((w) => !isTimed(form.w[w.id]))
  const pct = (x) => (win ? (x / win) * 100 : 0) + '%'
  const gaps = []; let cur = 0
  for (const r of timedRows) { if (r.ns > cur) gaps.push([cur, r.ns]); cur = Math.max(cur, r.ns + r.dur) }
  const otRows = timedRows.filter((r) => Number(r.f.ot_hours) > 0)
  const otTotal = otRows.reduce((s, r) => s + Number(r.f.ot_hours), 0)
  const ot = day.offer && otTotal > 0 ? deriveOT(cov, form.ot_position, [otTotal])[0] : null
  const ch = form.account.company_hours === '' ? null : Number(form.account.company_hours)
  // a gap that fits the part of the lunch NOT already inside the times is the lunch break itself
  const lunchFree = plan.poolMin - (plan.insideMin || 0)
  const lunchGap = cov.status === 'gap' && cov.gap <= lunchFree + 0.5
  const validation = cov.status === 'empty' ? ['empty', 'No shifts yet'] : cov.status === 'ok' ? ['ok', 'Full coverage'] : cov.status === 'gap' ? (lunchGap ? ['ok', `Lunch break ${Math.round(cov.gap)}m`] : ['gap', `${Math.round(cov.gap - lunchFree)}m uncovered`]) : ['overlap', `${cov.overlap}m overlap`]
  const addBlock = (w) => {
    const start = cov.start != null ? fmtMin(cov.end) : day.presets[0]?.time_in || '16:00'
    const end = cov.start != null ? fmtMin(cov.end + 270) : day.presets[0]?.time_out || '20:30'
    setW(w.id, { status: 'worked', time_in: start, time_out: end, suggested: false }); setEdit(w.id); setAdding(false)
  }
  return (
    <Page title="Account Day" eyebrow={eyebrow}>
      {d.stale && <div className="alert-banner"><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>Changed on another phone</strong><p>Someone in the organization updated this day while you were editing.</p></div><button onClick={d.reload}>Load theirs</button></div>}
      <DayNav date={date} setDate={setDate} today={today} />
      <section className="surface account-shift">
        <div className="section-heading" style={{ marginTop: 0 }}>
          <div><p className="eyebrow">Company shift</p><h2>{cov.start != null ? `${T(fmtMin(cov.start))} – ${T(fmtMin(cov.end))}` : 'No shifts yet'}</h2></div>
        </div>
        <div className="account-stats">
          <Metric label="Worked" value={cov.hours ? hm(cov.hours) : '—'} />
          <Metric label="Paid lunch" value={plan.poolMin > 0 ? hm(plan.poolMin / 60) : 'None'} />
          <Metric label="Paid hours" value={cov.hours ? hm(timedRows.reduce((s, r) => s + paidHours(r.f, plan), 0)) : '—'} />
        </div>
        <div className="form-grid three">
          <Field label="Company shows (hours)"><input type="number" min="0" step="0.25" value={form.account.company_hours} onChange={(e) => setForm({ ...form, account: { ...form.account, company_hours: e.target.value } })} /></Field>
          <Field label="Paid lunch to add (hours)"><input type="number" min="0" step="0.25" placeholder={autoPlan.totalMin > 0 ? `auto: ${Math.round(autoPlan.totalMin) / 60}` : 'auto: none'} value={form.account.lunch_hours} onChange={(e) => setForm({ ...form, account: { ...form.account, lunch_hours: e.target.value } })} /></Field>
          <Field label="Note"><input value={form.account.note} onChange={(e) => setForm({ ...form, account: { ...form.account, note: e.target.value } })} /></Field>
        </div>
        {ch != null && cov.hours > 0 && Math.abs(ch - (cov.hours + lunchFree / 60)) > 0.01 && <div className="alert-banner compact" style={{ marginBottom: 0 }}><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>Hours don’t match</strong><p>Workers’ paid time (worked + lunch) is {hm(cov.hours + lunchFree / 60)}, but the company shows {hm(ch)}. Informational only; pay is not affected.</p></div></div>}
      </section>

      <section className="surface timeline-card">
        <div className="section-heading" style={{ marginTop: 0 }}>
          <div><h2>Coverage timeline</h2><p>Assignments connect at each handoff.</p></div>
          <span className={`validation ${validation[0]}`}><Icon name={validation[0] === 'ok' ? 'check' : 'alert'} size={14} />{validation[1]}</span>
        </div>
        {win > 0 ? (
          <>
            <div className="timeline-labels">{[0, 1, 2, 3, 4].map((i) => <span key={i}>{hourLabel(cov.start + (win * i) / 4)}</span>)}</div>
            <div className="timeline abs">
              {timedRows.map((r, i) => <div key={r.w.id} className={`segment ${i === 0 ? 'first' : ''} ${i === timedRows.length - 1 ? 'last' : ''}`} style={{ left: pct(r.ns), width: pct(r.dur), background: r.w.color }}><strong>{r.w.name}</strong><span>{short(r.f.time_in)} – {short(r.f.time_out)}</span><small>{hm(r.dur / 60)}</small></div>)}
              {gaps.map(([a, b]) => <div key={a} className={`segment-gap ${lunchGap ? 'lunch' : ''}`} style={{ left: pct(a), width: pct(b - a) }}>{lunchGap && <span>Lunch</span>}</div>)}
              {timedRows.slice(1).filter((r) => r.ns > 0 && r.ns < win).map((r) => <div key={'h' + r.w.id} className="handoff" style={{ left: pct(r.ns) }}><span>{short(r.f.time_in)}</span></div>)}
            </div>
          </>
        ) : <p className="muted-text">Add a block below to see the day’s coverage.</p>}
      </section>

      <section className="surface">
        <div className="section-heading" style={{ marginTop: 0 }}>
          <div><h2>Shift assignments</h2><p>Regular hours</p></div>
          {unassigned.length > 0 && <button className="outline-button" onClick={() => setAdding(!adding)}><Icon name="plus" size={16} /> Add block</button>}
        </div>
        {adding && <div className="pill-row" style={{ marginBottom: 10 }}>{unassigned.map((w) => <button key={w.id} className="outline-button" onClick={() => addBlock(w)}><Avatar w={w} small /> {w.name}</button>)}</div>}
        {timedRows.length === 0 && <p className="muted-text">No worked blocks for this day yet. Use “Add block”, or log hours on the Daily Log.</p>}
        {timedRows.map((r) => (
          <div key={r.w.id}>
            <div className="assignment-row">
              <span className="drag">⠿</span><Avatar w={r.w} small />
              <div className="assignment-name"><strong>{r.w.name}</strong><span>{T(r.f.time_in)} – {T(r.f.time_out)}{r.f.status === 'worked' && plan.perMin > 0 ? ` · lunch +${Math.round(plan.perMin * 10) / 10}m` : ''}{Number(r.f.ot_hours) ? ` · OT ${hm(Number(r.f.ot_hours))}` : ''}</span></div>
              <strong>{hm(paidHours(r.f, plan))}</strong>
              <button className="icon-button" aria-label={`Edit ${r.w.name}'s block`} disabled={r.w.paid} onClick={() => setEdit(edit === r.w.id ? null : r.w.id)}><Icon name="edit" size={17} /></button>
            </div>
            {edit === r.w.id && (
              <div className="assignment-edit">
                <div className="form-grid three" style={{ marginTop: 0 }}>
                  <Field label="Hours (type it)"><input inputMode="decimal" placeholder="e.g. 4 or 4:30" value={hoursDraft[r.w.id] ?? String(Math.round((r.dur / 60) * 100) / 100)} onChange={(e) => typeHours(r.w.id, e.target.value)} onBlur={() => endHours(r.w.id)} /></Field>
                  <Field label="Time in"><input type="time" value={r.f.time_in} onChange={(e) => setW(r.w.id, { time_in: e.target.value })} /></Field>
                  <Field label="Time out"><input type="time" value={r.f.time_out} onChange={(e) => setW(r.w.id, { time_out: e.target.value })} /></Field>
                </div>
                <div className="form-grid">
                  {day.offer && <Field label="OT hours after the shift"><input type="number" min="0" step="0.25" value={r.f.ot_hours} onChange={(e) => setW(r.w.id, { ot_hours: e.target.value })} /></Field>}
                  <Field label="Paid lunch (min, blank = automatic)"><input type="number" min="0" step="5" placeholder={String(Math.round(plan.perMin * 10) / 10)} value={r.f.lunch_min} onChange={(e) => setW(r.w.id, { lunch_min: e.target.value })} /></Field>
                </div>
                <button className="text-button" onClick={() => { setW(r.w.id, { status: '', time_in: '', time_out: '', ot_hours: '', lunch_min: '' }); setEdit(null) }}>Remove this block</button>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="surface overtime-card">
        <div className="section-heading" style={{ marginTop: 0 }}>
          <div><p className="eyebrow">Overtime segment</p><h2>{day.offer ? day.offer.name : 'No OT offer on this date'}</h2></div>
          {day.offer && <span className="provisional">{day.offer.stats.final ? 'Final' : 'Provisional'}</span>}
        </div>
        {day.offer ? (
          <>
            <div className="ot-range">
              <div><span>Placement</span><strong>{form.ot_position === 'before' ? 'Before shift' : 'After shift'}</strong></div>
              <div><span>Time</span><strong>{ot ? `${short(ot.ot_start)} – ${short(ot.ot_end)}` : '—'}</strong></div>
              <div><span>Hours</span><strong>{otTotal ? hm(otTotal) : '—'}</strong></div>
            </div>
            <div className="form-grid"><Field label="Place OT"><select value={form.ot_position} onChange={(e) => setForm({ ...form, ot_position: e.target.value })}><option value="after">After the shift (continues it)</option><option value="before">Before the shift</option></select></Field>
              <Field label="OT available today (hours, all workers together)"><input type="number" min="0.25" step="0.25" key={date + ':' + day.offer.cap_today} defaultValue={day.offer.cap_today} onBlur={(e) => e.target.value !== String(day.offer.cap_today) && saveCap(e.target.value)} /></Field></div>
            <div className="mini-progress">
              <div><span>Pooled progress</span><strong>{h2(day.offer.stats.total)} of {day.offer.min_hours}h</strong></div>
              <div className="progress-track"><span style={{ width: Math.min(100, (day.offer.stats.total / (day.offer.min_hours || 1)) * 100) + '%' }} /></div>
              <p>{day.offer.stats.qualified ? `Minimum reached: ${$(day.offer.qualified_rate)}/h applies to OT in this offer.` : `${h2(day.offer.stats.remaining)}h combined remaining to unlock the ${$(day.offer.qualified_rate)} qualified rate.`}</p>
            </div>
          </>
        ) : <p className="muted-text">Create an OT offer covering this date to enter overtime.</p>}
      </section>
      <button className="primary-button full-button" disabled={d.saving} onClick={() => d.save()}><Icon name="check" size={18} /> {d.saving ? 'Saving…' : 'Save account day'}</button>
    </Page>
  )
}
