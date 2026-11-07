import React, { createContext, useContext } from 'react'
import { Icon } from './Icon.jsx'
import { addMonths, monthLabel } from './lib.js'
import { getEngine } from './storage.js'
import { storageInfo } from './lib.js'
export { Icon }

export const ShellCtx = createContext({ go: () => {} })
export const useShell = () => useContext(ShellCtx)

export const initials = (name = '?') => { const p = name.trim().split(/\s+/); return ((p[0]?.[0] || '?') + (p[1]?.[0] || p[0]?.[1] || '')).toUpperCase() }
export const Avatar = ({ w, small, large }) => <span className={`avatar ${small ? 'avatar-sm' : ''} ${large ? 'large' : ''}`} style={{ background: w?.color || '#4169a1' }}>{initials(w?.name || w?.worker_name)}</span>
export const Metric = ({ label, value, tone }) => <div className={`metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong></div>
export const Field = ({ label, children, className = '' }) => <label className={`field ${className}`}><span>{label}</span>{children}</label>
export const Loading = () => <div className="muted-text" style={{ padding: 28 }}>Loading…</div>
export const ErrorBox = ({ error }) => error ? <div className="alert-banner"><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>{error}</strong></div></div> : null
export const StatusLabel = ({ s, children }) => <span className={'status-label ' + ({ rd: 'rd', not_worked: 'rd', training: 'training', not_logged: 'not-logged' }[s] || '')}>{children}</span>

export function Header({ title, eyebrow }) {
  const { go } = useShell()
  const m = getEngine().meta()
  const days = m.lastBackupAt ? Math.floor((Date.now() - Date.parse(m.lastBackupAt)) / 864e5) : null
  const due = m.hasData && (days === null || days >= m.reminderDays)
  return (
    <header className="page-header">
      <div className="header-title"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1></div></div>
      <div className="header-actions">
        <button className="icon-button notification" aria-label={due ? 'Back up your data (due)' : 'Backup & export'} onClick={() => go('files', 'backup')}><Icon name="download" />{due && <span />}</button>
      </div>
    </header>
  )
}

function Banners() {
  const { go } = useShell()
  const m = getEngine().meta()
  const days = m.lastBackupAt ? Math.floor((Date.now() - Date.parse(m.lastBackupAt)) / 864e5) : null
  const due = m.hasData && (days === null || days >= m.reminderDays)
  return (
    <>
      {storageInfo.mode === 'memory' && <div className="alert-banner"><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>This browser can’t save data</strong><p>Everything you enter is lost when you close the tab (private browsing?). Open the app in a normal window.</p></div></div>}
      {due && <div className="alert-banner"><span className="alert-icon"><Icon name="alert" size={19} /></span><div><strong>{days === null ? 'No backup yet' : `Last backup ${days} days ago`}</strong><p>Your records are stored only on this device. Download a backup file and keep it somewhere safe.</p></div><button onClick={() => go('files', 'backup')}>Back up</button></div>}
    </>
  )
}

export function Page({ title, eyebrow, narrow = true, className = '', children }) {
  return <><Header title={title} eyebrow={eyebrow} /><main className={`page-content ${narrow ? 'narrow-content' : ''} ${className}`}><Banners />{children}</main></>
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="text-button" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  )
}

export function MonthNav({ month, setMonth }) {
  return (
    <div className="date-navigator">
      <button className="icon-button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><Icon name="arrow" size={18} /></button>
      <div><span>Viewing month</span><strong>{monthLabel(month)}</strong></div>
      <button className="icon-button next" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><Icon name="arrow" size={18} /></button>
    </div>
  )
}
