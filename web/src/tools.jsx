import React, { useRef, useState } from 'react'
import { api, useLoad, useToast, $, h2, addMonths, fmtDate, monthLabel, downloadExport, downloadBackup, restoreBackup, eraseAll, loadDemo, storageInfo } from './lib.js'
import { Page, Icon, Metric, Field, Loading, MonthNav, Avatar, useShell } from './ui.jsx'
import { T } from './daily.jsx'

export function Welcome() {
  const { go } = useShell()
  return (
    <Page title="Welcome" eyebrow="Getting started">
      <section className="overview-card">
        <h2>Let’s set things up</h2>
        <p className="muted-text" style={{ marginTop: 6 }}>Track hours, OT and review bonuses for everyone who shares the company account, then export the monthly Excel workbook.</p>
        <ol className="welcome-list">
          <li>Add the people who share the account in <b>Workers &amp; Rates</b>.</li>
          <li>Pick this month’s rest days in <b>Settings</b>.</li>
          <li>Log each day in the <b>Daily Log</b>.</li>
          <li>At month end open <b>Month Summary</b> or <b>Import / Export</b> to get the Excel file.</li>
        </ol>
        <p className="muted-text">Everything is saved on this device only. Download a backup from <b>Import / Export</b> regularly.</p>
        <div className="pill-row"><button className="primary-button" onClick={() => go('workers')}><Icon name="plus" size={17} /> Add workers</button><button className="outline-button" onClick={() => go('settings')}>Try sample data</button></div>
      </section>
    </Page>
  )
}

export function FilesPage({ month, setMonth, workers, tab, setTab }) {
  const toast = useToast()
  const { data: sum } = useLoad(`/summary/${month}`)
  const { data: meta, reload } = useLoad('/meta')
  const [sel, setSel] = useState(() => workers.map((w) => w.id))
  const [opts, setOpts] = useState({ summary: true, ot: true, daily: true, weekday: true })
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const file = useRef(null)
  const monthName = monthLabel(month).split(' ')[0]
  const months = Array.from({ length: 19 }, (_, i) => addMonths(new Date().toISOString().slice(0, 7), i - 17))
  if (!months.includes(month)) months.push(month)
  const days = meta?.lastBackupAt ? Math.floor((Date.now() - Date.parse(meta.lastBackupAt)) / 864e5) : null
  const chk = (k, l) => <label><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /><span><Icon name="check" size={13} /></span>{l}</label>
  const pickFile = async (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f || !window.confirm('Restoring replaces everything currently in the app with the contents of this backup. Continue?')) return
    try { await restoreBackup(await f.text()); toast('Backup restored'); setTimeout(() => location.reload(), 700) } catch (er) { toast(er.message, 'error') }
  }
  return (
    <Page title="Import & Export" eyebrow="Excel workbooks and backups">
      <div className="file-tabs">
        <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}><Icon name="download" />Export</button>
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}><Icon name="file" />Paste notes</button>
        <button className={tab === 'backup' ? 'active' : ''} onClick={() => setTab('backup')}><Icon name="upload" />Backup</button>
      </div>
      {tab === 'export' && (
        <section className="surface export-card">
          <div className="export-icon"><Icon name="file" size={30} /></div>
          <h2>{monthName} Invoice.xlsx</h2>
          <p>One sheet per worker with live formulas, plus your summary, OT and daily account sheets.</p>
          <label>Month<select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          <div className="worker-filter">{workers.map((w) => <button key={w.id} className={sel.includes(w.id) ? 'active' : ''} onClick={() => setSel(sel.includes(w.id) ? sel.filter((x) => x !== w.id) : [...sel, w.id])}>{w.name}</button>)}</div>
          <div className="check-list">{chk('summary', 'Summary sheet')}{chk('ot', 'OT summary')}{chk('daily', 'Account daily sheet')}{chk('weekday', 'Weekday in dates')}</div>
          {sum && sum.notLogged > 0 && <div className="alert-banner compact"><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>{sum.notLogged} entries are not logged</strong><p>Complete them for an accurate workbook.</p></div></div>}
          <button className="primary-button full-button" disabled={!sel.length} onClick={() => downloadExport(month, { workers: sel, ...opts }).catch((e) => toast(e.message, 'error'))}><Icon name="download" size={18} /> Download workbook</button>
        </section>
      )}
      {tab === 'notes' && (
        <section className="surface">
          <div className="section-heading" style={{ marginTop: 0 }}><div><h2>Paste Messenger notes</h2><p>Lines like “sam oct 24 8:30pm-1am ot 2h”. Nothing is saved until you confirm.</p></div></div>
          <Field label="Notes"><textarea rows="5" value={text} onChange={(e) => setText(e.target.value)} placeholder={'sam oct 24 8:30pm-1am\nalex 10/25 4pm to 8:30pm ot 2h\njo oct 26 rd'} /></Field>
          <button className="outline-button full-button" disabled={!text.trim()} onClick={() => api('/parse', { method: 'POST', body: { text, year: +month.slice(0, 4) } }).then(setRows).catch((e) => toast(e.message, 'error'))}>Read notes</button>
          {rows && (
            <div style={{ marginTop: 14 }}>
              {rows.map((r, i) => (
                <article className="list-card" key={i} style={{ marginBottom: 8 }}>
                  <span className={'menu-icon ' + (r.ok ? 'success' : 'warning')}><Icon name={r.ok ? 'check' : 'alert'} /></span>
                  <div><h3>{r.ok ? `${r.worker} · ${fmtDate(r.date, { month: 'short', day: 'numeric' })}` : r.error}</h3><p>{r.ok ? (r.status === 'rd' ? 'Rest day' : `${T(r.time_in)} – ${T(r.time_out)}${r.ot_hours ? ` · OT ${h2(r.ot_hours)}h` : ''}`) : r.line}</p></div>
                </article>
              ))}
              <button className="primary-button full-button" disabled={!rows.some((r) => r.ok)} onClick={() => api('/apply-notes', { method: 'POST', body: { items: rows } }).then((r) => { toast(`${r.saved} entries saved`); setRows(null); setText('') }).catch((e) => toast(e.message, 'error'))}>Save {rows.filter((r) => r.ok).length} entries</button>
            </div>
          )}
        </section>
      )}
      {tab === 'backup' && (
        <section className="surface export-card">
          <div className="export-icon"><Icon name="upload" size={30} /></div>
          <h2>Back up your data</h2>
          <p>Everything lives only on this device. A backup is one small file you can keep in Google Drive, email to yourself or send on Messenger. {meta?.lastBackupAt ? `Last backup: ${days === 0 ? 'today' : days + (days === 1 ? ' day' : ' days') + ' ago'}.` : 'No backup yet.'}</p>
          <button className="primary-button full-button" onClick={() => { downloadBackup(); toast('Backup downloaded. Keep it somewhere safe.'); setTimeout(reload, 300) }}><Icon name="download" size={18} /> Download backup</button>
          <button className="outline-button full-button" style={{ marginTop: 10 }} onClick={() => file.current.click()}><Icon name="upload" size={18} /> Restore from a backup</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={pickFile} />
        </section>
      )}
    </Page>
  )
}

export function SettingsPage({ month, setMonth, onChange, dark, setDark }) {
  const toast = useToast()
  const { data: s, reload: reloadS } = useLoad('/settings')
  const { data: sch, reload: reloadSch } = useLoad(`/schedule/${month}`)
  const { data: meta } = useLoad('/meta')
  const [presets, setPresets] = useState(null)
  const [bonus, setBonus] = useState(null)
  const [lunch, setLunch] = useState(null)
  if (!s || !sch || !meta) return <Page title="Settings" eyebrow="Preferences"><Loading /></Page>
  const P = presets || s.presets, B = bonus ?? s.default_review_bonus
  const LU = lunch || { auto: s.lunch_auto, minutes: s.lunch_minutes, threshold: s.lunch_threshold, from: s.lunch_from || '' }
  const put = (body, msg) => api('/settings', { method: 'PUT', body }).then(() => { toast(msg || 'Saved'); reloadS(); onChange() }).catch((e) => toast(e.message, 'error'))
  const setDays = (weekdays) => api(`/schedule/${month}`, { method: 'PUT', body: { weekdays } }).then(reloadSch)
  const modeText = { idb: 'Saved on this device.', local: 'Saved on this device (basic mode).', memory: 'This browser is not letting the app save anything (private mode?). Data will be lost when the tab closes.' }[storageInfo.mode]
  const upd = (i, k, v) => setPresets(P.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  return (
    <Page title="Settings" eyebrow="Preferences">
      <MonthNav month={month} setMonth={setMonth} />
      <section className="settings-group">
        <h2>Rest days · {monthLabel(month)}</h2>
        <div className="worker-filter">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n, d) => <button key={d} className={sch.weekdays.includes(d) ? 'active' : ''} onClick={() => setDays(sch.weekdays.includes(d) ? sch.weekdays.filter((x) => x !== d) : [...sch.weekdays, d])}>{n}</button>)}</div>
        <div className="block"><p className="muted-text">{sch.confirmed ? 'Confirmed for this month.' : 'Suggested from last month. Confirm it to lock it in.'} Rest days are pre-marked on the daily log; entries you already logged are never overwritten.</p>
          {!sch.confirmed && <button className="primary-button small" style={{ marginTop: 10 }} onClick={() => api(`/schedule/${month}`, { method: 'PUT', body: { weekdays: sch.weekdays } }).then(() => { toast('Schedule confirmed'); reloadSch() })}>Confirm for {monthLabel(month)}</button>}</div>
      </section>
      <section className="settings-group">
        <h2>Shift presets</h2>
        <div className="block">
          {P.map((p, i) => (
            <div className="preset-edit" key={i}>
              <Field label="Name"><input value={p.label} onChange={(e) => upd(i, 'label', e.target.value)} /></Field>
              <Field label="Start"><input type="time" value={p.time_in} onChange={(e) => upd(i, 'time_in', e.target.value)} /></Field>
              <Field label="End"><input type="time" value={p.time_out} onChange={(e) => upd(i, 'time_out', e.target.value)} /></Field>
              <button className="icon-button" aria-label="Remove preset" onClick={() => setPresets(P.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
            </div>
          ))}
          <div className="pill-row"><button className="outline-button" onClick={() => setPresets([...P, { label: 'New', time_in: '16:00', time_out: '20:30' }])}><Icon name="plus" size={16} /> Add preset</button>
            <button className="primary-button small" style={{ alignSelf: 'center' }} onClick={() => put({ presets: P }, 'Presets saved').then(() => setPresets(null))}>Save presets</button></div>
        </div>
      </section>
      <section className="settings-group">
        <h2>Paid lunch</h2>
        <label className="toggle-row"><span><strong>Add paid lunch automatically</strong><small>A full shift has a paid lunch that is shared equally by the workers of that day and added to their time</small></span><input type="checkbox" checked={LU.auto} onChange={(e) => setLunch({ ...LU, auto: e.target.checked })} /><i /></label>
        <div className="block">
          <div className="form-grid three" style={{ marginTop: 0 }}>
            <Field label="Lunch (minutes)"><input type="number" min="0" step="5" value={LU.minutes} onChange={(e) => setLunch({ ...LU, minutes: e.target.value })} /></Field>
            <Field label="Full shift (worked hours)"><input type="number" min="1" step="0.5" value={LU.threshold} onChange={(e) => setLunch({ ...LU, threshold: e.target.value })} /></Field>
            <Field label="Applies from"><input type="date" value={LU.from} onChange={(e) => setLunch({ ...LU, from: e.target.value })} /></Field>
          </div>
          <p className="muted-text" style={{ marginTop: 10 }}>Example: {LU.threshold} worked hours plus {LU.minutes} minutes of paid lunch is {Math.round((Number(LU.threshold) * 60 + Number(LU.minutes)) / 6) / 10} paid hours. With 2 workers that day each gets +{Math.round(LU.minutes / 2 * 10) / 10} minutes, with 3 workers +{Math.round(LU.minutes / 3 * 10) / 10} minutes, paid at their own hourly rate. Days shorter than a full shift get no lunch, and Training hours get none. You can override one day on Account Day. Days before “Applies from” keep their old numbers.</p>
          <div className="pill-row">
            <button className="primary-button small" onClick={() => put({ lunch_auto: LU.auto, lunch_minutes: LU.minutes, lunch_threshold: LU.threshold, lunch_from: LU.from || null }, 'Lunch rule saved').then(() => setLunch(null))}>Save lunch rule</button>
            <button className="outline-button" onClick={() => { if (window.confirm('This recalculates EVERY saved day, including months already marked paid, so past totals will change. Download a backup first. Continue?')) put({ lunch_from: null }, 'Paid lunch now applies to all past days').then(() => setLunch(null)) }}>Apply to all past days</button>
          </div>
        </div>
      </section>
      <section className="settings-group">
        <h2>Payment</h2>
        <div className="block"><div className="form-grid" style={{ marginTop: 0 }}><Field label="Default review bonus ($)"><input type="number" step="0.01" value={B} onChange={(e) => setBonus(e.target.value)} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="primary-button small" onClick={() => put({ default_review_bonus: B }).then(() => setBonus(null))}>Save</button></div></div>
          <p className="muted-text" style={{ marginTop: 8 }}>Each review’s amount can still be changed when you add it.</p></div>
      </section>
      <section className="settings-group">
        <h2>General</h2>
        <div className="block"><Field label="Timezone (decides what “today” is)"><input defaultValue={s.timezone} onBlur={(e) => e.target.value !== s.timezone && put({ timezone: e.target.value }, 'Timezone saved')} /></Field></div>
        <label className="toggle-row"><span><strong>Dark mode</strong><small>Easier on the eyes at night</small></span><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /><i /></label>
      </section>
      <section className="settings-group">
        <h2>This device</h2>
        <div className="block"><p className="muted-text">{modeText}{storageInfo.mode !== 'memory' && (storageInfo.persisted ? ' The browser has agreed to keep it.' : ' Your browser may clear it if the phone runs out of space, so keep backups.')}</p>
          <div className="form-grid" style={{ marginTop: 12 }}><Field label="Remind me to back up every (days)"><input type="number" min="1" defaultValue={s.reminder_days} onBlur={(e) => put({ reminder_days: e.target.value })} /></Field></div></div>
        {!meta.hasData && <div className="block"><button className="outline-button" onClick={() => { try { loadDemo(); toast('Sample data loaded (October 2026)'); onChange() } catch (e) { toast(e.message, 'error') } }}>Load sample data</button></div>}
      </section>
      <button className="logout-button" onClick={() => { if (window.confirm('Erase ALL data from this device? Download a backup first if you might need it.') && window.confirm('Really erase everything? This cannot be undone.')) { eraseAll(); toast('Everything erased'); setTimeout(() => location.reload(), 500) } }}><Icon name="trash" size={18} /> Erase all data</button>
    </Page>
  )
}

export function MorePage({ dark, setDark }) {
  const { go } = useShell()
  const items = [['account', 'Account Day', 'clock', 'Divide company shifts'], ['ot', 'OT Offers', 'briefcase', 'Manage pooled overtime'], ['bonuses', 'Review Bonuses', 'gift', 'Track customer reviews'],
    ['workers', 'Workers & Rates', 'users', 'Rates and team'], ['files', 'Import / Export', 'file', 'Excel workbooks and backups'], ['settings', 'Settings', 'settings', 'Schedule and preferences']]
  return (
    <Page title="More" eyebrow="Tools">
      <section className="more-profile"><span className="avatar avatar-owner large">SH</span><div><h2>Shiftly</h2><p>Work &amp; payout · stored on this device</p></div></section>
      <div className="more-grid">
        {items.map(([id, label, icon, sub]) => <button key={id} onClick={() => go(id)}><span className="menu-icon"><Icon name={icon} /></span><div><strong>{label}</strong><small>{sub}</small></div><Icon name="chevron" size={17} /></button>)}
        <button onClick={() => setDark(!dark)}><span className="menu-icon"><Icon name={dark ? 'sun' : 'moon'} /></span><div><strong>{dark ? 'Light mode' : 'Dark mode'}</strong><small>Change the appearance</small></div></button>
      </div>
    </Page>
  )
}
