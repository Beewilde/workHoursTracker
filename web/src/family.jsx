// Family sync screen: sign in, create or join the family, see sync status, share the invite code.
import React, { useEffect, useState } from 'react'
import { useToast, downloadBackup } from './lib.js'
import { Page, Icon, Field, Loading } from './ui.jsx'
import { cloudConfigured, onSyncStatus, sendCode, verifyCode, signOut, listFamilies, createFamily, joinFamily, openFamily, newInviteCode, syncNow } from './cloud.js'
import { getEngine } from './storage.js'

export const useSyncStatus = () => {
  const [s, set] = useState(() => ({ state: 'off' }))
  useEffect(() => onSyncStatus(set), [])
  return s
}
const ago = (iso) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
export const syncLabel = (s) => ({
  off: 'On this phone only', starting: 'Starting…', 'signed-out': 'Family sync is off', 'no-family': 'Signed in · no family yet',
  idle: 'Waiting to sync', syncing: 'Syncing…', ok: `Synced ${ago(s.lastSyncAt)}`, warning: 'Some changes were refused',
  offline: 'Offline · changes saved here',
}[s.state] || s.state)

const hasLocalData = () => { const S = getEngine().state; return S.workers.length + S.entries.length + S.bonuses.length > 0 }
const Section = ({ title, children }) => <section className="settings-group"><h2>{title}</h2><div className="block">{children}</div></section>

function SignIn() {
  const toast = useToast()
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [busy, setBusy] = useState(false)
  const go = (f) => async () => { setBusy(true); try { await f() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) } }
  return (
    <Section title="Sign in">
      <p className="muted-text">Sign in to share the records with your family. Everyone sees the same workers, days and payouts, and each phone keeps working without signal.</p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Email"><input type="email" autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} /></Field>
        {sent && <Field label="6-digit code from the email"><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>}
      </div>
      <div className="pill-row">
        {!sent
          ? <button className="primary-button small" disabled={busy || !/\S+@\S+/.test(email)} onClick={go(async () => { await sendCode(email); setSent(true); toast('Code sent. Check your email.') })}>Send code</button>
          : <><button className="primary-button small" disabled={busy || code.trim().length < 6} onClick={go(() => verifyCode(email, code))}>Sign in</button>
              <button className="outline-button" onClick={() => { setSent(false); setCode('') }}>Use another email</button></>}
      </div>
    </Section>
  )
}

function ChooseFamily({ status }) {
  const toast = useToast()
  const [fams, setFams] = useState(null), [name, setName] = useState('My family'), [code, setCode] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { listFamilies().then(setFams).catch((e) => { toast(e.message, 'error'); setFams([]) }) }, [])
  const run = (f) => async () => { setBusy(true); try { await f() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) } }
  // joining replaces what is on this phone with the family's records
  const okToReplace = () => !hasLocalData() || (window.confirm('This phone already has records. Joining replaces them with the family’s records. Download a backup of this phone first?')
    ? (downloadBackup(), window.confirm('Backup started. Join the family now?')) : window.confirm('Replace this phone’s records with the family’s?'))
  if (!fams) return <Loading />
  return (
    <>
      {fams.length > 0 && <Section title="Your families">
        {fams.map((f) => <div key={f.id} className="pill-row" style={{ alignItems: 'center' }}><strong style={{ flex: 1 }}>{f.name}</strong><span className="muted-text">{f.role}</span>
          <button className="primary-button small" disabled={busy} onClick={run(async () => { if (okToReplace()) { await openFamily(f.id); toast('Family opened. Downloading records…') } })}>Use on this phone</button></div>)}
      </Section>}
      <Section title="Join your family">
        <p className="muted-text">Ask whoever set it up for the invite code (it’s on their Family sync screen).</p>
        <div className="form-grid" style={{ marginTop: 12 }}><Field label="Invite code"><input value={code} autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} /></Field></div>
        <div className="pill-row"><button className="primary-button small" disabled={busy || code.trim().length < 6} onClick={run(async () => { if (okToReplace()) { await joinFamily(code); toast('Joined. Downloading records…') } })}>Join</button></div>
      </Section>
      <Section title="Or start a new family">
        <p className="muted-text">Do this on ONE phone only — the one with the records you want to keep. {hasLocalData() ? 'This phone’s records will be uploaded.' : 'This phone has no records yet.'}</p>
        <div className="form-grid" style={{ marginTop: 12 }}><Field label="Family name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <div className="pill-row"><button className="outline-button" disabled={busy || !name.trim()} onClick={run(async () => { await createFamily(name); toast('Family created. Uploading records…') })}>Create family</button></div>
      </Section>
      <button className="logout-button" onClick={() => signOut()}><Icon name="user" size={18} /> Sign out{status.email ? ` (${status.email})` : ''}</button>
    </>
  )
}

function Synced({ status }) {
  const toast = useToast()
  const [fam, setFam] = useState(null)
  useEffect(() => { listFamilies().then((fs) => setFam(fs.find((f) => f.id === status.household_id) || null)).catch(() => {}) }, [status.household_id])
  return (
    <>
      <Section title={fam ? fam.name : 'Family sync'}>
        <p><strong>{syncLabel(status)}</strong></p>
        <p className="muted-text" style={{ marginTop: 6 }}>{status.state === 'offline'
          ? 'No connection to the server. Everything you enter is saved on this phone and uploads when you’re back online.'
          : 'Changes upload a few seconds after you make them, and other phones’ changes arrive every minute or when you open the app.'}</p>
        {status.rejected?.length > 0 && <div className="alert-banner" style={{ marginTop: 12 }}><span className="alert-icon"><Icon name="alert" size={19} /></span>
          <div><strong>Not saved to the family copy</strong>{status.rejected.map((r, i) => <p key={i}>{r.message}</p>)}<p>This phone now shows the family’s version of those records.</p></div></div>}
        <div className="pill-row"><button className="primary-button small" disabled={status.state === 'syncing'} onClick={() => syncNow()}>Sync now</button></div>
      </Section>
      {fam && <Section title="Invite family members">
        <p className="muted-text">On their phone: install the app, open Family sync, sign in with their own email and enter this code.</p>
        <p style={{ fontSize: 28, letterSpacing: 4, margin: '10px 0' }}><strong>{fam.invite_code}</strong></p>
        {fam.role === 'owner' && <button className="outline-button" onClick={() => newInviteCode(fam.id).then((c) => { setFam({ ...fam, invite_code: c }); toast('New code made; the old one no longer works') }).catch((e) => toast(e.message, 'error'))}>Make a new code</button>}
      </Section>}
      <button className="logout-button" onClick={() => { if (window.confirm('Sign out? This phone keeps its records but stops syncing.')) signOut() }}><Icon name="user" size={18} /> Sign out</button>
    </>
  )
}

export function FamilyPage() {
  const status = useSyncStatus()
  return (
    <Page title="Family sync" eyebrow="Share with your family">
      {!cloudConfigured ? <Section title="Not set up"><p className="muted-text">This build has no Supabase project. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the .env file and rebuild (see SETUP.md). Until then everything stays on this phone.</p></Section>
        : status.state === 'starting' ? <Loading />
        : status.state === 'signed-out' ? <SignIn />
        : status.state === 'no-family' ? <ChooseFamily status={status} />
        : <Synced status={status} />}
    </Page>
  )
}
