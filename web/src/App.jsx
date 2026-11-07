import React, { useEffect, useState } from 'react'
import { useLoad, ToastCtx, todayIn } from './lib.js'
import { Icon, Loading, ShellCtx } from './ui.jsx'
import { initEngine, getEngine, subscribe } from './storage.js'
import { DailyLog, AccountDay } from './daily.jsx'
import { CalendarPage, SummaryPage, OffersPage, BonusesPage, WorkersPage } from './views.jsx'
import { FilesPage, SettingsPage, MorePage, Welcome } from './tools.jsx'

const NAV = [
  ['daily', 'Daily Log', 'grid'], ['account', 'Account Day', 'clock'], ['calendar', 'Calendar', 'calendar'], ['summary', 'Month Summary', 'wallet'],
  ['ot', 'OT Offers', 'briefcase'], ['bonuses', 'Review Bonuses', 'gift'], ['workers', 'Workers & Rates', 'users'], ['files', 'Import / Export', 'file'], ['settings', 'Settings', 'settings'],
]
const BOTTOM = [['daily', 'Daily Log', 'grid'], ['calendar', 'Calendar', 'calendar'], ['summary', 'Summary', 'wallet'], ['more', 'More', 'more']]

function MainApp({ dark, setDark }) {
  const [, tick] = useState(0)
  useEffect(() => subscribe(() => tick((n) => n + 1)), [])
  const { data: settings, reload: reloadSettings } = useLoad('/settings')
  const { data: workers, reload: reloadWorkers } = useLoad('/workers')
  const [page, setPage] = useState('daily')
  const [date, setDate] = useState(null)
  const [month, setMonth] = useState(null)
  const [filesTab, setFilesTab] = useState('export')
  if (!settings || !workers) return <div className="app-main" style={{ paddingLeft: 0 }}><Loading /></div>
  const today = todayIn(settings.timezone), d = date || today, m = month || today.slice(0, 7)
  const active = workers.filter((w) => w.active)
  const go = (p, tab) => { setPage(p); if (tab) setFilesTab(tab); window.scrollTo(0, 0) }
  const needsWorkers = ['daily', 'account', 'calendar', 'summary', 'bonuses'].includes(page) && active.length === 0
  const meta = getEngine().meta()
  const days = meta.lastBackupAt ? Math.floor((Date.now() - Date.parse(meta.lastBackupAt)) / 864e5) : null
  const screen = needsWorkers ? <Welcome /> : {
    daily: <DailyLog date={d} setDate={setDate} today={today} />,
    account: <AccountDay date={d} setDate={setDate} today={today} />,
    calendar: <CalendarPage month={m} setMonth={setMonth} today={today} openDay={(x) => { setDate(x); go('daily') }} />,
    summary: <SummaryPage month={m} setMonth={setMonth} />,
    ot: <OffersPage />, bonuses: <BonusesPage month={m} setMonth={setMonth} workers={active} />,
    workers: <WorkersPage onChange={reloadWorkers} />,
    files: <FilesPage key={active.length} month={m} setMonth={setMonth} workers={active} tab={filesTab} setTab={setFilesTab} />,
    settings: <SettingsPage month={m} setMonth={setMonth} onChange={() => { reloadSettings(); reloadWorkers() }} dark={dark} setDark={setDark} />,
    more: <MorePage dark={dark} setDark={setDark} />,
  }[page]
  const bottomActive = BOTTOM.some((b) => b[0] === page) ? page : 'more'
  return (
    <ShellCtx.Provider value={{ go }}>
      <aside className="sidebar">
        <div className="brand"><span><Icon name="clock" size={21} /></span><div><strong>Shiftly</strong><small>Work &amp; payout</small></div></div>
        <nav aria-label="Main">
          {NAV.map(([id, label, icon]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon name={icon} /><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'} /><span>{dark ? 'Light mode' : 'Dark mode'}</span></button>
          <div className="side-profile"><span className="avatar avatar-owner">SH</span><div><strong>This device</strong><small>{days === null ? 'No backup yet' : days === 0 ? 'Backed up today' : `Backup ${days}d ago`}</small></div><Icon name="more" size={17} /></div>
        </div>
      </aside>
      <div className="app-main">{screen}</div>
      <nav className="bottom-nav" aria-label="Main (mobile)">
        {BOTTOM.map(([id, label, icon]) => <button key={id} className={bottomActive === id ? 'active' : ''} onClick={() => go(id)}><Icon name={icon} /><span>{label}</span></button>)}
      </nav>
    </ShellCtx.Provider>
  )
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [toast, setToast] = useState(null)
  const [dark, setDarkState] = useState(() => { try { return (localStorage.getItem('shiftly-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' } catch { return false } })
  useEffect(() => { initEngine().then(() => setReady(true)) }, [])
  const setDark = (v) => { setDarkState(v); try { localStorage.setItem('shiftly-theme', v ? 'dark' : 'light') } catch { /* ignore */ } }
  const show = (msg, kind = 'ok') => { setToast({ msg, kind }); clearTimeout(show.t); show.t = setTimeout(() => setToast(null), 4500) }
  return (
    <ToastCtx.Provider value={show}>
      <div className={dark ? 'app dark' : 'app'}>
        {ready ? <MainApp dark={dark} setDark={setDark} /> : <Loading />}
        {toast && <div className={'toast ' + toast.kind} role="status"><span><Icon name={toast.kind === 'error' ? 'alert' : 'check'} size={16} /></span><div><strong>{toast.msg}</strong></div></div>}
      </div>
    </ToastCtx.Provider>
  )
}
