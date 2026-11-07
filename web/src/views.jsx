import React, { useState } from 'react'
import { api, useLoad, useToast, $, h2, addDays, addMonths, fmtDate, monthLabel, downloadExport } from './lib.js'
import { Page, Icon, Avatar, Metric, Field, Modal, Loading, ErrorBox, StatusLabel, MonthNav, useShell } from './ui.jsx'
import { T, hm } from './daily.jsx'

const bind = (s, set, k) => ({ value: s[k] ?? '', onChange: (e) => set({ ...s, [k]: e.target.value }) })
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CalendarPage({ month, setMonth, today, openDay }) {
  const { data, loading, error } = useLoad(`/calendar/${month}`)
  const [sel, setSel] = useState(today)
  const [filter, setFilter] = useState('all')
  const selDate = sel.startsWith(month) ? sel : month + '-01'
  const { data: day } = useLoad(`/day/${selDate}`)
  if (error) return <Page title="Month Calendar" eyebrow="Attendance overview"><ErrorBox error={error} /></Page>
  if (loading || !data) return <Page title="Month Calendar" eyebrow="Attendance overview"><Loading /></Page>
  const days = Object.keys(data.days), first = new Date(month + '-01T00:00:00Z').getUTCDay()
  return (
    <Page title="Month Calendar" eyebrow="Attendance overview">
      <section className="surface calendar-card">
        <div className="calendar-head">
          <button className="icon-button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><Icon name="arrow" size={17} /></button>
          <div><p className="eyebrow">Viewing month</p><h2>{monthLabel(month)}</h2></div>
          <button className="icon-button next" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><Icon name="arrow" size={17} /></button>
        </div>
        <div className="worker-filter">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All workers</button>
          {data.workers.map((w) => <button key={w.id} className={filter === w.id ? 'active' : ''} onClick={() => setFilter(w.id)}>{w.name}</button>)}
        </div>
        <div className="weekdays">{WD.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calendar-grid">
          {Array.from({ length: first }).map((_, i) => <button key={'b' + i} disabled />)}
          {days.map((d, i) => (
            <button key={d} className={`${d === selDate ? 'selected' : ''} ${d === data.today ? 'today' : ''} ${data.weekdays.includes((first + i) % 7) ? 'rest' : ''}`} onClick={() => setSel(d)}>
              <span>{i + 1}</span>
              <div className="day-dots">
                {data.workers.filter((w) => filter === 'all' || w.id === filter).map((w) => {
                  const s = data.days[d][w.id]
                  if (s === 'not_logged') return d <= data.today ? <i key={w.id} className="amber" /> : null
                  if (s === 'rd' || s === 'not_worked') return <i key={w.id} className="grey" />
                  if (s === 'training') return <i key={w.id} className="green" />
                  return <i key={w.id} style={{ background: w.color }} />
                })}
              </div>
            </button>
          ))}
        </div>
        <div className="calendar-legend">
          {data.workers.map((w) => <span key={w.id}><i style={{ background: w.color }} />{w.name} worked</span>)}
          <span><i className="grey" />Rest / not worked</span><span><i className="green" />Training</span><span><i className="amber" />Not logged</span>
        </div>
      </section>
      <section className="surface selected-day">
        <div className="section-heading" style={{ marginTop: 0 }}>
          <div><p className="eyebrow">Selected day</p><h2>{fmtDate(selDate, { weekday: 'long', month: 'long', day: 'numeric' })}</h2></div>
          <button className="text-button" onClick={() => openDay(selDate)}>Open day</button>
        </div>
        {!day ? <Loading /> : day.workers.filter((w) => filter === 'all' || w.id === filter).map((w) => {
          const r = w.row, s = r.status
          return (
            <button className="day-worker" key={w.id} onClick={() => openDay(selDate)}>
              <Avatar w={w} small />
              <div><strong>{w.name}</strong><span>{s === 'rd' ? 'Rest day' : s === 'not_worked' ? 'Not worked' : s === 'not_logged' ? 'Not logged' : `${T(r.time_in)} – ${T(r.time_out)}`}</span></div>
              <StatusLabel s={s}>{s === 'rd' ? 'RD' : s === 'not_worked' ? 'Off' : s === 'not_logged' ? 'Missing' : hm(r.hours)}</StatusLabel>
              <Icon name="chevron" size={17} />
            </button>
          )
        })}
      </section>
    </Page>
  )
}

export function SummaryPage({ month, setMonth }) {
  const toast = useToast()
  const { data, loading, error, reload } = useLoad(`/summary/${month}`)
  const [unpaidOnly, setUnpaidOnly] = useState(false)
  if (error) return <Page title="Month Summary" eyebrow={monthLabel(month)} narrow={false}><ErrorBox error={error} /></Page>
  if (loading || !data) return <Page title="Month Summary" eyebrow={monthLabel(month)} narrow={false}><Loading /></Page>
  const t = data.totals
  const rows = data.rows.filter((r) => !unpaidOnly || !r.paidAt)
  const toggle = (r) => api(`/paid/${month}/${r.worker.id}`, { method: 'PUT', body: { paid: !r.paidAt } }).then(() => { toast(r.paidAt ? 'Marked unpaid' : `${r.worker.name} marked paid and locked`); reload() }).catch((e) => toast(e.message, 'error'))
  return (
    <Page title="Month Summary" eyebrow={monthLabel(month)} narrow={false}>
      <MonthNav month={month} setMonth={setMonth} />
      <div className="summary-hero">
        <div><p className="eyebrow">Grand total payout</p><h2>{$(t.total)}</h2><span>Across {data.rows.filter((r) => r.worker.active).length} active workers</span></div>
        <button className="light-button" onClick={() => downloadExport(month).catch((e) => toast(e.message, 'error'))}><Icon name="download" size={17} /> Export month</button>
      </div>
      <div className="summary-metrics">
        <Metric label="Regular hours" value={hm(t.regularHours) || '0h'} /><Metric label="OT hours" value={hm(t.otHours) || '0h'} />
        <Metric label="Regular pay" value={$(t.regularPay)} /><Metric label="OT pay" value={$(t.otPay)} /><Metric label="Review bonuses" value={$(t.bonusTotal)} />
      </div>
      {data.notLogged > 0 && <div className="alert-banner"><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>{data.notLogged} worker-days have no entry</strong><p>Complete them in the calendar for an accurate month.</p></div></div>}
      <div className="section-heading"><div><h2>Worker payouts</h2><p>Review earnings and payment status.</p></div><button className="outline-button" onClick={() => setUnpaidOnly(!unpaidOnly)}>{unpaidOnly ? 'Show all' : 'Unpaid only'}</button></div>
      <div className="payout-table surface">
        <div className="table-head"><span>Worker</span><span>Shifts</span><span>Regular</span><span>Overtime</span><span>Bonuses</span><span>Total</span><span>Status</span></div>
        {rows.length === 0 && <div className="payout-row"><span>Nothing to show.</span></div>}
        {rows.map((r) => (
          <div className="payout-row" key={r.worker.id}>
            <div className="worker-identity"><Avatar w={r.worker} small /><div><strong>{r.worker.name}</strong><small>{r.shifts} {r.shifts === 1 ? "shift" : "shifts"} · {hm(r.regularHours) || "0h"}</small></div></div>
            <span className="desktop-cell">{r.shifts}</span><span className="desktop-cell">{$(r.regularPay)}</span>
            <span className="desktop-cell">{$(r.otPay)}</span><span className="desktop-cell">{$(r.bonusTotal)}</span>
            <strong className="row-total">{$(r.total)}</strong>
            <button className={`payment-button ${r.paidAt ? 'paid' : ''}`} onClick={() => toggle(r)}>{r.paidAt ? <><Icon name="lock" size={14} /> Paid</> : 'Mark paid'}</button>
          </div>
        ))}
      </div>
      {data.offers.map((o) => (
        <section className="surface" key={o.id}><div className="section-heading" style={{ margin: 0 }}><div><p className="eyebrow">OT offer</p><h2>{o.name}</h2></div><span className="provisional">{o.stats.final ? 'Final' : 'Provisional'}</span></div>
          <div className="mini-progress"><div><span>Pooled progress</span><strong>{h2(o.stats.total)} of {o.min_hours}h</strong></div><div className="progress-track"><span style={{ width: Math.min(100, (o.stats.total / (o.min_hours || 1)) * 100) + '%' }} /></div>
            <p>{o.stats.qualified ? `Minimum reached: ${$(o.qualified_rate)}/h on OT hours.` : 'Below the minimum: OT is paid at each worker’s regular rate.'}</p></div></section>
      ))}
    </Page>
  )
}

export function OffersPage() {
  const toast = useToast()
  const { data, loading, error, reload } = useLoad('/offers')
  const [tab, setTab] = useState('active')
  const [edit, setEdit] = useState(null)
  const header = { title: 'OT Offers', eyebrow: 'Pooled overtime' }
  if (error) return <Page {...header}><ErrorBox error={error} /></Page>
  if (loading || !data) return <Page {...header}><Loading /></Page>
  const empty = { name: '', start_date: '', end_date: '', cap_hours: '', min_hours: '', qualified_rate: '', below_min_rate: '', tier_mode: 'whole', notes: '' }
  const list = data.filter((o) => (tab === 'active' ? o.active : !o.active))
  const save = async () => {
    try {
      const r = await api(edit.id ? `/offers/${edit.id}` : '/offers', { method: edit.id ? 'PUT' : 'POST', body: edit })
      toast(r.warnings?.[0] || 'Offer saved', r.warnings?.length ? 'error' : 'ok'); setEdit(null); reload()
    } catch (e) { toast(e.message, 'error') }
  }
  const del = (o) => window.confirm(`Delete "${o.name}"?`) && api(`/offers/${o.id}`, { method: 'DELETE' }).then(() => { toast('Offer deleted'); reload() }).catch((e) => toast(e.message, 'error'))
  return (
    <Page {...header}>
      <div className="tabs">
        <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>Active</button>
        <button className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>Past offers</button>
        <button className="primary-button small" onClick={() => setEdit(empty)}><Icon name="plus" size={16} /> Create offer</button>
      </div>
      {list.length === 0 && <section className="surface"><p className="muted-text">{tab === 'active' ? 'No active OT offers. When the company announces one, create it here with its dates, cap, minimum hours and rates.' : 'No past offers yet.'}</p></section>}
      {list.map((o) => {
        const pct = Math.min(100, Math.round((o.stats.total / (o.min_hours || 1)) * 100))
        return (
          <article className="offer-card" key={o.id}>
            <div className="offer-head"><div><span className={`active-pill ${o.active ? '' : 'final'}`}>{o.active ? 'Active offer' : 'Ended'}</span><h2>{o.name}</h2><p>{fmtDate(o.start_date, { month: 'long', day: 'numeric' })} – {fmtDate(o.end_date, { month: 'long', day: 'numeric', year: 'numeric' })}</p></div></div>
            <div className="offer-progress">
              <div className="ring" style={{ background: `radial-gradient(closest-side,var(--surface) 80%,transparent 81% 99%),conic-gradient(var(--blue) ${pct}%,var(--border) 0)` }}><strong>{pct}%</strong><span>{o.stats.qualified ? 'qualified' : 'of minimum'}</span></div>
              <div className="offer-progress-copy"><p>Account pooled progress</p><h3>{h2(o.stats.total)} of {o.min_hours} hours</h3>
                <div className="progress-track"><span style={{ width: pct + '%' }} /></div>
                <span>{o.stats.qualified ? `Minimum reached: ${$(o.qualified_rate)}/hour applies` : `${h2(o.stats.remaining)} hours remaining for the ${$(o.qualified_rate)}/hour rate`}</span></div>
            </div>
            <div className="offer-terms">
              <div><span>Per-shift cap</span><strong>{o.cap_hours} hours</strong></div>
              <div><span>Qualified rate</span><strong>{$(o.qualified_rate)} / hour</strong></div>
              <div><span>Current status</span><strong className={o.stats.final ? '' : 'amber-text'}>{o.stats.final ? 'Final' : 'Provisional'}</strong></div>
            </div>
            <div className="offer-terms">
              <div><span>Minimum total</span><strong>{o.min_hours} hours</strong></div>
              <div><span>Below minimum</span><strong>{o.below_min_rate != null ? $(o.below_min_rate) + ' / hour' : 'Regular rate'}</strong></div>
              <div><span>Rate applies to</span><strong>{o.tier_mode === 'whole' ? 'All OT hours' : 'Hours past minimum'}</strong></div>
            </div>
            <div className="contributions">
              <p className="field-label">Worker contributions</p>
              {o.contributions.length === 0 && <p className="muted-text" style={{ paddingTop: 8 }}>No OT logged yet.</p>}
              {o.contributions.map((c) => <div key={c.id}><span><Avatar w={c} small />{c.name}</span><strong>{hm(c.hours)} · {$(c.pay)}</strong></div>)}
            </div>
            <div className="offer-actions">
              <button className="outline-button" onClick={() => setEdit({ ...o })}><Icon name="edit" size={16} /> Edit</button>
              <button className="outline-button" onClick={() => setEdit({ ...o, id: undefined, name: o.name + ' (copy)', start_date: addDays(o.end_date, 1), end_date: addDays(o.end_date, 7) })}>Duplicate</button>
              <button className="outline-button danger" onClick={() => del(o)}><Icon name="trash" size={16} /> Delete</button>
            </div>
          </article>
        )
      })}
      <div className="info-card"><Icon name="alert" size={18} /><div><strong>How pooled OT works</strong><p>The company counts everyone on the account as one person. When the combined OT hours reach the offer’s minimum, the qualified rate applies; otherwise OT is paid at each worker’s regular rate. Each offer is counted on its own.</p></div></div>
      {edit && (
        <Modal title={edit.id ? 'Edit OT offer' : 'New OT offer'} onClose={() => setEdit(null)}>
          <div className="form-stack">
            <Field label="Name"><input {...bind(edit, setEdit, 'name')} placeholder="e.g. Week 4 OT" /></Field>
            <div className="form-grid" style={{ marginTop: 0 }}><Field label="First shift date"><input type="date" {...bind(edit, setEdit, 'start_date')} /></Field><Field label="Last shift date"><input type="date" {...bind(edit, setEdit, 'end_date')} /></Field></div>
            <div className="form-grid" style={{ marginTop: 0 }}><Field label="Max OT hours per shift"><input type="number" step="0.25" {...bind(edit, setEdit, 'cap_hours')} /></Field><Field label="Minimum total OT hours"><input type="number" step="0.25" {...bind(edit, setEdit, 'min_hours')} /></Field></div>
            <div className="form-grid" style={{ marginTop: 0 }}><Field label="Qualified rate ($/h)"><input type="number" step="0.01" {...bind(edit, setEdit, 'qualified_rate')} /></Field><Field label="Below minimum ($/h, blank = regular)"><input type="number" step="0.01" {...bind(edit, setEdit, 'below_min_rate')} /></Field></div>
            <Field label="When the minimum is reached"><select {...bind(edit, setEdit, 'tier_mode')}><option value="whole">Pay the qualified rate on ALL OT hours in this offer</option><option value="marginal">Pay it only on hours past the minimum</option></select></Field>
            <Field label="Notes"><input {...bind(edit, setEdit, 'notes')} /></Field>
            <button className="primary-button" onClick={save}>Save offer</button>
          </div>
        </Modal>
      )}
    </Page>
  )
}

export function BonusesPage({ month, setMonth, workers }) {
  const toast = useToast()
  const { data, loading, error, reload } = useLoad(`/bonuses?month=${month}`)
  const { data: settings } = useLoad('/settings')
  const [edit, setEdit] = useState(null)
  const [who, setWho] = useState(null)
  const total = (data || []).reduce((s, b) => s + b.amount, 0)
  const header = { title: 'Review Bonuses', eyebrow: `${monthLabel(month)} · ${$(total)} total` }
  if (error) return <Page {...header}><ErrorBox error={error} /></Page>
  if (loading || !data) return <Page {...header}><Loading /></Page>
  const open = (b) => { setWho(null); setEdit(b || { worker_id: workers[0]?.id ?? '', review_date: month + '-' + String(Math.min(new Date().getDate(), 28)).padStart(2, '0'), reference: '', note: '', chat_time: '', amount: settings?.default_review_bonus ?? 10 }) }
  const save = () => api(edit.id ? `/bonuses/${edit.id}` : '/bonuses', { method: edit.id ? 'PUT' : 'POST', body: edit }).then(() => { toast('Bonus saved'); setEdit(null); reload() }).catch((e) => toast(e.message, 'error'))
  const del = () => window.confirm('Delete this bonus?') && api(`/bonuses/${edit.id}`, { method: 'DELETE' }).then(() => { setEdit(null); reload() }).catch((e) => toast(e.message, 'error'))
  const suggest = () => api(`/covered?date=${edit.review_date}&time=${edit.chat_time}`).then(setWho).catch((e) => toast(e.message, 'error'))
  return (
    <Page {...header}>
      <MonthNav month={month} setMonth={setMonth} />
      <button className="primary-button top-action" onClick={() => open()}><Icon name="plus" size={17} /> Add bonus</button>
      {data.length === 0 && <section className="surface" style={{ clear: 'both' }}><p className="muted-text">No review bonuses for {monthLabel(month)}. Trustpilot reviews name the company account; credit each one to whoever handled that customer.</p></section>}
      {data.map((b) => (
        <article className="list-card" key={b.id}>
          <span className="menu-icon success"><Icon name="gift" /></span>
          <div><h3>{b.worker_name}</h3><p>{fmtDate(b.review_date, { month: 'short', day: 'numeric' })} · {b.reference || 'Review'}</p>{b.note && <small>{b.note}</small>}</div>
          <strong>{$(b.amount)}</strong>
          <button className="icon-button" aria-label="Edit bonus" onClick={() => open(b)}><Icon name="edit" size={17} /></button>
        </article>
      ))}
      {edit && (
        <Modal title={edit.id ? 'Edit review bonus' : 'Add review bonus'} onClose={() => setEdit(null)}>
          <div className="form-stack">
            <div className="form-grid" style={{ marginTop: 0 }}><Field label="Review date"><input type="date" {...bind(edit, setEdit, 'review_date')} /></Field><Field label="Customer chat time (optional)"><input type="time" {...bind(edit, setEdit, 'chat_time')} /></Field></div>
            {edit.chat_time && <div><button className="outline-button" onClick={suggest}>Who was on shift then?</button>
              {who && <div className="pill-row">{who.length ? who.map((w) => <button key={w.id} className="outline-button" onClick={() => setEdit({ ...edit, worker_id: w.id })}>{w.name}</button>) : <span className="muted-text">Nobody was logged at that time.</span>}</div>}</div>}
            <Field label="Credit to"><select value={edit.worker_id} onChange={(e) => setEdit({ ...edit, worker_id: +e.target.value })}>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Reviewer name or link"><input {...bind(edit, setEdit, 'reference')} /></Field>
            <div className="form-grid" style={{ marginTop: 0 }}><Field label="Bonus ($)"><input type="number" step="0.01" {...bind(edit, setEdit, 'amount')} /></Field><Field label="Pay month (YYYY-MM, optional)"><input {...bind(edit, setEdit, 'pay_month')} placeholder={edit.review_date?.slice(0, 7)} /></Field></div>
            <Field label="Note"><input {...bind(edit, setEdit, 'note')} /></Field>
            <button className="primary-button" onClick={save}>Save bonus</button>
            {edit.id && <button className="outline-button danger" onClick={del}><Icon name="trash" size={16} /> Delete bonus</button>}
          </div>
        </Modal>
      )}
    </Page>
  )
}

export function WorkersPage({ onChange }) {
  const toast = useToast()
  const { data, loading, error, reload } = useLoad('/workers')
  const [add, setAdd] = useState(null)
  const [manage, setManage] = useState(null)
  const [rate, setRate] = useState({ effective_from: '', rate: '' })
  const header = { title: 'Workers & Rates', eyebrow: data ? `${data.filter((w) => w.active).length} active workers` : '' }
  if (error) return <Page {...header}><ErrorBox error={error} /></Page>
  if (loading || !data) return <Page {...header}><Loading /></Page>
  const after = () => { reload(); onChange() }
  const cur = manage && data.find((w) => w.id === manage)
  return (
    <Page {...header}>
      <button className="primary-button top-action" onClick={() => setAdd({ name: '', rate: 5 })}><Icon name="plus" size={17} /> Add worker</button>
      {data.length === 0 && <section className="surface" style={{ clear: 'both' }}><p className="muted-text">Add the people who share the company account and split its hours.</p></section>}
      {data.map((w) => (
        <article className={`worker-management ${w.active ? '' : 'inactive'}`} key={w.id}>
          <div className="worker-identity"><Avatar w={w} /><div><h3>{w.name}</h3><p>{w.active ? <><span className="online-dot" /> Active</> : 'Inactive'}</p></div></div>
          <div className="rate-box"><span>Hourly rate</span><strong>{$(w.rate)}</strong><small>{w.rates.length > 1 ? `${w.rates.length} rates on file` : 'No changes yet'}</small></div>
          <button className="outline-button" onClick={() => { setManage(w.id); setRate({ effective_from: '', rate: '' }) }}>Manage</button>
        </article>
      ))}
      {add && (
        <Modal title="Add worker" onClose={() => setAdd(null)}>
          <div className="form-stack">
            <Field label="Name"><input autoFocus {...bind(add, setAdd, 'name')} /></Field>
            <Field label="Hourly rate ($)"><input type="number" step="0.01" {...bind(add, setAdd, 'rate')} /></Field>
            <button className="primary-button" onClick={() => api('/workers', { method: 'POST', body: add }).then(() => { setAdd(null); after(); toast('Worker added') }).catch((e) => toast(e.message, 'error'))}>Add worker</button>
          </div>
        </Modal>
      )}
      {cur && (
        <Modal title={cur.name} onClose={() => setManage(null)}>
          <p className="field-label" style={{ marginBottom: 8 }}>Hourly rate history</p>
          {[...cur.rates].sort((a, b) => b.effective_from.localeCompare(a.effective_from)).map((r, i) => <div className="rate-line" key={i}><span>{r.effective_from === '2000-01-01' ? 'From the start' : 'From ' + fmtDate(r.effective_from, { month: 'short', day: 'numeric', year: 'numeric' })}</span><strong>{$(r.rate)}</strong></div>)}
          <div className="form-grid"><Field label="New rate starts on"><input type="date" value={rate.effective_from} onChange={(e) => setRate({ ...rate, effective_from: e.target.value })} /></Field><Field label="New hourly rate ($)"><input type="number" step="0.01" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} /></Field></div>
          <button className="primary-button full-button" onClick={() => api(`/workers/${cur.id}/rates`, { method: 'POST', body: rate }).then(() => { setRate({ effective_from: '', rate: '' }); after(); toast('Rate added') }).catch((e) => toast(e.message, 'error'))}>Add rate</button>
          <button className="outline-button full-button" style={{ marginTop: 10 }} onClick={() => api(`/workers/${cur.id}/active`, { method: 'POST', body: { active: !cur.active } }).then(() => { after(); setManage(null) })}>{cur.active ? 'Deactivate worker' : 'Reactivate worker'}</button>
          <p className="muted-text" style={{ marginTop: 10 }}>Deactivating hides the worker from the daily log. Their history and totals stay.</p>
        </Modal>
      )}
    </Page>
  )
}
