import React, { useEffect, useState } from 'react'
import { api, useLoad, useToast, $, h2, addDays, fmtDate } from './lib.js'
import { Page, Icon, Avatar, Metric, Field, Loading, ErrorBox, StatusLabel, useShell } from './ui.jsx'
import { spanMin, toMin, coverage, deriveOT, fmtMin, lunchPlan, paidHours } from '../../shared/calc.js'

export const T = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const short = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')}` }
export const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') + 'm' : ''}` }
const hourLabel = (min) => { const t = fmtMin(min), [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}` }
const blank = { time_in: '', time_out: '', ot_hours: '', rate_override: '', rate_override_reason: '', remark: '' }
const STATUS_LABEL = { worked: 'Worked', rd: 'RD', not_worked: 'Not worked', training: 'Training' }
export const isTimed = (f) => f.status === 'worked' || f.status === 'training'

export function useDay(date) {
  const toast = useToast()
  const { data: day, loading, error, reload } = useLoad(`/day/${date}`)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!day) return
    const w = {}
    for (const x of day.workers) {
      const e = x.entry
      w[x.id] = e
        ? { status: e.status, time_in: e.time_in || '', time_out: e.time_out || '', ot_hours: e.ot_hours || '', rate_override: e.rate_override ?? '', rate_override_reason: e.rate_override_reason || '', remark: e.remark || '' }
        : { ...blank, status: day.isRestDay ? 'rd' : '', suggested: day.isRestDay }
    }
    setForm({ w, ot_position: day.workers.find((x) => x.entry?.ot_position)?.entry.ot_position || 'after',
      account: { company_hours: day.account.company_hours ?? '', lunch_hours: day.account.lunch_hours ?? '', note: day.account.note || '' } })
  }, [day])
  const ready = !!(day && form && day.date === date)
  const setW = (id, p) => setForm((f) => ({ ...f, w: { ...f.w, [id]: { ...f.w[id], ...p } } }))
  const cov = ready ? coverage(day.workers.filter((w) => isTimed(form.w[w.id])).map((w) => ({ ...form.w[w.id] }))) : null
  const lunchOf = (override) => lunchPlan(day.workers.map((w) => ({ ...form.w[w.id] })), { ...day.lunchSettings, override, date })
  const plan = ready ? lunchOf(form.account.lunch_hours) : null
  const autoPlan = ready ? lunchOf('') : null

  async function save(force = false) {
    setSaving(true)
    // send blocks in time order so OT slices follow the same order
    const order = (f) => (isTimed(f) && cov?.start != null ? (toMin(f.time_in) - cov.start + 1440) % 1440 : 9999)
    const entries = day.workers.filter((w) => form.w[w.id].status).map((w) => {
      const x = form.w[w.id]
      return { worker_id: w.id, status: x.status, time_in: x.time_in || null, time_out: x.time_out || null, ot_hours: x.ot_hours === '' ? 0 : Number(x.ot_hours),
        rate_override: x.rate_override === '' ? null : Number(x.rate_override), rate_override_reason: x.rate_override_reason, remark: x.remark || null, _o: order(x) }
    }).sort((a, b) => a._o - b._o).map(({ _o, ...e }) => e)
    try {
      const r = await api(`/day/${date}`, { method: 'PUT', body: { entries, force, ot_position: form.ot_position, account: form.account } })
      const notes = r.warnings.map((x) => x.type === 'gap' ? `${x.minutes} min gap in coverage` : x.type === 'overlap' ? `${x.minutes} min overlap` : `Workers total ${h2(x.siblings)} h, company shows ${h2(x.company)} h`)
      toast(notes.length ? 'Saved. Check: ' + notes.join('; ') : 'Daily log saved', notes.length ? 'error' : 'ok')
      reload()
    } catch (e) {
      if (e.data?.needsConfirm && window.confirm(e.message + ' Save anyway?')) return save(true)
      toast(e.message, 'error')
    } finally { setSaving(false) }
  }
  return { day, form, setForm, setW, ready, loading, error, save, saving, cov, plan, autoPlan }
}

export function DayNav({ date, setDate, today }) {
  return (
    <div className="date-navigator">
      <button className="icon-button" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><Icon name="arrow" size={18} /></button>
      <div className="date-pick"><span>{date === today ? 'Today' : fmtDate(date, { weekday: 'long' })}</span><strong>{fmtDate(date, { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
        <input type="date" aria-label="Pick a date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      <button className="icon-button next" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><Icon name="arrow" size={18} /></button>
    </div>
  )
}

export function DailyLog({ date, setDate, today }) {
  const { go } = useShell()
  const d = useDay(date)
  const [custom, setCustom] = useState({})
  const [more, setMore] = useState({})
  const eyebrow = fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })
  if (d.error) return <Page title="Daily Log" eyebrow={eyebrow}><ErrorBox error={d.error} /></Page>
  if (!d.ready) return <Page title="Daily Log" eyebrow={eyebrow}><Loading /></Page>
  const { day, form, setW, plan } = d
  const rows = day.workers.map((w) => ({ w, f: form.w[w.id] }))
  const logged = rows.filter((r) => r.f.status).length
  const regH = rows.reduce((s, r) => s + (isTimed(r.f) ? paidHours(r.f, plan) : 0), 0)
  const otH = rows.reduce((s, r) => s + (Number(r.f.ot_hours) || 0), 0)
  const n = rows.length
  return (
    <>
      <Page title="Daily Log" eyebrow={eyebrow} narrow={false} className="daily-page">
        <DayNav date={date} setDate={setDate} today={today} />
        <section className="overview-card">
          <div className="overview-title"><div><p className="eyebrow">Daily overview</p><h2>Team status</h2></div><span className="completion">{logged}/{n} logged</span></div>
          <div className="metric-row">
            <Metric label="Regular hours" value={hm(regH) || '0h'} />
            <Metric label="Overtime" value={otH ? hm(otH) : '0h'} />
            <Metric label="Not logged" value={`${n - logged}`} tone={logged < n ? 'warning-text' : ''} />
          </div>
          <div className="progress-track"><span style={{ width: `${n ? (logged / n) * 100 : 0}%` }} /></div>
        </section>
        {logged < n && (
          <div className="alert-banner">
            <span className="alert-icon"><Icon name="alert" size={19} /></span>
            <div><strong>Missing daily entries</strong><p>{rows.filter((r) => !r.f.status).map((r) => r.w.name).join(', ')} {n - logged === 1 ? 'is' : 'are'} still unlogged for this day.</p></div>
            <button onClick={() => go('calendar')}>Calendar</button>
          </div>
        )}
        {day.isRestDay && <div className="info-card"><Icon name="calendar" size={18} /><div><strong>Scheduled rest day</strong><p>Matches this month’s rest-day schedule{day.schedule.confirmed ? '' : ' (suggested from last month; confirm it in Settings)'}. Workers without an entry are pre-marked RD.</p></div></div>}
        {day.offer && (
          <div className="info-card"><Icon name="briefcase" size={18} /><div><strong>OT offer · {day.offer.name}</strong>
            <p>Up to {day.offer.cap_hours}h OT per shift (entered {h2(otH)}h today). {day.offer.stats.qualified ? 'Minimum reached.' : `${h2(day.offer.stats.remaining)}h to the ${day.offer.min_hours}h minimum.`}</p>
            <div className="progress-track" style={{ marginTop: 8 }}><span style={{ width: Math.min(100, (day.offer.stats.total / (day.offer.min_hours || 1)) * 100) + '%' }} /></div></div></div>
        )}
        {plan.totalMin > 0 && <div className="info-card"><Icon name="clock" size={18} /><div><strong>Paid lunch added</strong><p>{Math.round(plan.totalMin * 10) / 10} min of paid lunch shared by {plan.n} worker{plan.n === 1 ? '' : 's'}: +{Math.round(plan.perMin * 10) / 10} min each ({plan.source === 'manual' ? 'set by hand on Account Day' : 'automatic for a full shift'}). It is already included in the paid time and pay below.</p></div></div>}
        <div className="section-heading"><div><h2>Worker logs</h2><p>Choose a status and shift for each worker.</p></div><span className="live-dot">Live totals</span></div>
        <div className="worker-grid">
          {rows.map(({ w, f }) => {
            const timed = isTimed(f), hrs = timed ? spanMin(f.time_in, f.time_out) / 60 : 0, paid = timed ? paidHours(f, plan) : 0, off = w.paid
            const lunchMin = f.status === 'worked' ? plan.perMin : 0
            const rate = f.rate_override !== '' ? Number(f.rate_override) : w.rate
            const match = day.presets.some((p) => p.time_in === f.time_in && p.time_out === f.time_out)
            const showCustom = custom[w.id] || (f.time_in && !match)
            return (
              <article className={`worker-card ${!f.status ? 'unlogged' : ''}`} key={w.id}>
                <div className="worker-head">
                  <div className="worker-identity"><Avatar w={w} /><div><h3>{w.name}</h3><p>{f.status ? STATUS_LABEL[f.status] + (f.suggested ? ' (suggested)' : '') : 'Not logged yet'}</p></div></div>
                  {f.status && <StatusLabel s={f.status}><Icon name="check" size={13} />{STATUS_LABEL[f.status]}</StatusLabel>}
                </div>
                <div className="status-control">
                  {Object.entries(STATUS_LABEL).map(([s, l]) => <button key={s} disabled={off} className={f.status === s ? 'active' : ''} onClick={() => setW(w.id, { status: s, suggested: false })}>{l}</button>)}
                </div>
                {timed && (
                  <div className="shift-details">
                    <p className="field-label">Shift preset</p>
                    <div className="preset-row">
                      {day.presets.map((p) => <button key={p.label} disabled={off} className={`preset ${f.time_in === p.time_in && f.time_out === p.time_out ? 'active' : ''}`} onClick={() => setW(w.id, { time_in: p.time_in, time_out: p.time_out })}><span>{p.label}</span><strong>{T(p.time_in)} – {T(p.time_out)}</strong></button>)}
                      <button className="add-preset" aria-label="Custom time" onClick={() => setCustom({ ...custom, [w.id]: !custom[w.id] })}><Icon name="plus" size={18} /></button>
                    </div>
                    {showCustom && <div className="form-grid">
                      <Field label="Time in"><input type="time" disabled={off} value={f.time_in} onChange={(e) => setW(w.id, { time_in: e.target.value })} /></Field>
                      <Field label="Time out"><input type="time" disabled={off} value={f.time_out} onChange={(e) => setW(w.id, { time_out: e.target.value })} /></Field>
                    </div>}
                    <div className="calculation"><span><Icon name="clock" size={16} /> Paid time</span><strong>{hrs > 0 ? `${hm(paid)} · ${$(paid * rate)}` : '—'}</strong></div>
                    {hrs > 0 && lunchMin > 0 && <p className="muted-text" style={{ marginTop: 6 }}>{hm(hrs)} worked + {Math.round(lunchMin * 10) / 10} min paid lunch share</p>}
                    {day.offer && (
                      <>
                        {Number(f.ot_hours) > 0 && <div className="ot-inline"><div><span>Active OT</span><strong>{form.ot_position === 'before' ? 'Before' : 'After'} shift · {hm(Number(f.ot_hours))}</strong></div><span className="provisional">{day.offer.stats.final ? 'Final' : 'Provisional'}</span></div>}
                        <div style={{ marginTop: 10 }}><Field label={`OT hours (up to ${day.offer.cap_hours}h per shift)`}><input type="number" min="0" step="0.25" disabled={off} value={f.ot_hours} onChange={(e) => setW(w.id, { ot_hours: e.target.value })} /></Field></div>
                      </>
                    )}
                    <button className="text-button" style={{ padding: '10px 0 0' }} onClick={() => setMore({ ...more, [w.id]: !more[w.id] })}>{more[w.id] || f.rate_override !== '' || f.remark ? 'Hide' : 'Add'} rate override / remark</button>
                    {(more[w.id] || f.rate_override !== '' || f.remark) && <div className="form-grid three">
                      <Field label="Rate override ($/h)"><input type="number" step="0.01" min="0" disabled={off} value={f.rate_override} placeholder={String(w.rate)} onChange={(e) => setW(w.id, { rate_override: e.target.value })} /></Field>
                      <Field label="Reason (required)"><input disabled={off} value={f.rate_override_reason} onChange={(e) => setW(w.id, { rate_override_reason: e.target.value })} /></Field>
                      <Field label="Remark"><input disabled={off} value={f.remark} onChange={(e) => setW(w.id, { remark: e.target.value })} /></Field>
                    </div>}
                  </div>
                )}
                {f.status === 'rd' && <div className="status-note"><Icon name="calendar" size={18} /><div><strong>Rest day</strong><p>No hours or pay for this day.</p></div></div>}
                {f.status === 'not_worked' && <div className="status-note"><Icon name="calendar" size={18} /><div><strong>Not worked</strong><p>No hours or pay for this day.</p></div></div>}
                {f.status === 'training' && <div className="status-note training" style={{ marginTop: 10 }}><Icon name="briefcase" size={18} /><div><strong>Paid training</strong><p>Training hours are paid at the regular rate.</p></div></div>}
                {!f.status && <button className="quick-worked" disabled={off} onClick={() => setW(w.id, { status: 'worked' })}><Icon name="plus" size={17} /> Start logging</button>}
                {off && <p className="muted-text" style={{ marginTop: 10 }}><Icon name="lock" size={13} /> This month is marked paid, so {w.name}’s entries are locked.</p>}
              </article>
            )
          })}
        </div>
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
  const eyebrow = 'Shift coverage'
  if (d.error) return <Page title="Account Day" eyebrow={eyebrow}><ErrorBox error={d.error} /></Page>
  if (!d.ready) return <Page title="Account Day" eyebrow={eyebrow}><Loading /></Page>
  const { day, form, setW, setForm, cov, plan, autoPlan } = d
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
  const validation = cov.status === 'empty' ? ['empty', 'No shifts yet'] : cov.status === 'ok' ? ['ok', 'Full coverage'] : cov.status === 'gap' ? ['gap', `${cov.gap}m gap`] : ['overlap', `${cov.overlap}m overlap`]
  const addBlock = (w) => {
    const start = cov.start != null ? fmtMin(cov.end) : day.presets[0]?.time_in || '16:00'
    const end = cov.start != null ? fmtMin(cov.end + 270) : day.presets[0]?.time_out || '20:30'
    setW(w.id, { status: 'worked', time_in: start, time_out: end, suggested: false }); setEdit(w.id); setAdding(false)
  }
  return (
    <Page title="Account Day" eyebrow={eyebrow}>
      <DayNav date={date} setDate={setDate} today={today} />
      <section className="surface account-shift">
        <div className="section-heading" style={{ marginTop: 0 }}>
          <div><p className="eyebrow">Company shift</p><h2>{cov.start != null ? `${T(fmtMin(cov.start))} – ${T(fmtMin(cov.end))}` : 'No shifts yet'}</h2></div>
        </div>
        <div className="account-stats">
          <Metric label="Worked" value={cov.hours ? hm(cov.hours) : '—'} />
          <Metric label="Paid lunch added" value={plan.totalMin > 0 ? hm(plan.totalMin / 60) : 'None'} />
          <Metric label="Paid hours" value={cov.hours ? hm(timedRows.reduce((s, r) => s + paidHours(r.f, plan), 0)) : '—'} />
        </div>
        <div className="form-grid three">
          <Field label="Company shows (hours)"><input type="number" min="0" step="0.25" value={form.account.company_hours} onChange={(e) => setForm({ ...form, account: { ...form.account, company_hours: e.target.value } })} /></Field>
          <Field label="Paid lunch to add (hours)"><input type="number" min="0" step="0.25" placeholder={autoPlan.totalMin > 0 ? `auto: ${Math.round(autoPlan.totalMin) / 60}` : 'auto: none'} value={form.account.lunch_hours} onChange={(e) => setForm({ ...form, account: { ...form.account, lunch_hours: e.target.value } })} /></Field>
          <Field label="Note"><input value={form.account.note} onChange={(e) => setForm({ ...form, account: { ...form.account, note: e.target.value } })} /></Field>
        </div>
        {ch != null && cov.hours > 0 && Math.abs(ch - (cov.hours + plan.totalMin / 60)) > 0.01 && <div className="alert-banner compact" style={{ marginBottom: 0 }}><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>Hours don’t match</strong><p>Workers’ paid time (worked + lunch) is {hm(cov.hours + plan.totalMin / 60)}, but the company shows {hm(ch)}. Informational only; pay is not affected.</p></div></div>}
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
              {gaps.map(([a, b]) => <div key={a} className="segment-gap" style={{ left: pct(a), width: pct(b - a) }} />)}
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
                <div className={`form-grid ${day.offer ? 'three' : ''}`} style={{ marginTop: 0 }}>
                  <Field label="Time in"><input type="time" value={r.f.time_in} onChange={(e) => setW(r.w.id, { time_in: e.target.value })} /></Field>
                  <Field label="Time out"><input type="time" value={r.f.time_out} onChange={(e) => setW(r.w.id, { time_out: e.target.value })} /></Field>
                  {day.offer && <Field label="OT hours"><input type="number" min="0" step="0.25" value={r.f.ot_hours} onChange={(e) => setW(r.w.id, { ot_hours: e.target.value })} /></Field>}
                </div>
                <button className="text-button" onClick={() => { setW(r.w.id, { status: '', time_in: '', time_out: '', ot_hours: '' }); setEdit(null) }}>Remove this block</button>
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
              <Field label="Cap"><input disabled value={`${day.offer.cap_hours}h per shift (all workers together)`} readOnly /></Field></div>
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
