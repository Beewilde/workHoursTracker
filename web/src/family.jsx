// Organization screen: sign in, create or join the organization, see sync status, share the invite code.
import React, { useEffect, useState } from 'react'
import { useToast, downloadBackup } from './lib.js'
import { Page, Icon, Field, Loading } from './ui.jsx'
import { cloudConfigured, onSyncStatus, syncStatus, signIn, createAccount, changePassword, signOut, listFamilies, createFamily, joinFamily, openFamily, newInviteCode, listMembers, removeMember, syncNow } from './cloud.js'
import { getEngine } from './storage.js'

// can this phone change the organization's settings, workers, paid months and saved logs?
// (not in an organization = it's all yours)
export const canManage = (s) => !s.household_id || s.role == null || s.role === 'owner'
export const useSyncStatus = () => {
  const [s, set] = useState(() => syncStatus())
  useEffect(() => onSyncStatus(set), [])
  return s
}
const ago = (iso) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
export const syncLabel = (s) => ({
  off: 'On this phone only', starting: 'Starting…', 'signed-out': 'Not signed in', 'no-family': 'Signed in · no organization yet',
  idle: 'Waiting to sync', syncing: 'Syncing…', ok: `Synced ${ago(s.lastSyncAt)}`, warning: 'Some changes were refused',
  offline: 'Offline · changes saved here',
}[s.state] || s.state)

const hasLocalData = () => { const S = getEngine().state; return S.workers.length + S.entries.length + S.bonuses.length > 0 }
const Section = ({ title, children }) => <section className="settings-group"><h2>{title}</h2><div className="block">{children}</div></section>

function SignIn() {
  const toast = useToast()
  const [mode, setMode] = useState('signin'), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [busy, setBusy] = useState(false)
  const creating = mode === 'create'
  const ok = /\S+@\S+\.\S+/.test(email) && pw.length >= 6 && (!creating || pw === pw2)
  const submit = async () => { setBusy(true); try { await (creating ? createAccount(email, pw) : signIn(email, pw)) } catch (e) { toast(e.message, 'error') } finally { setBusy(false) } }
  return (
    <Section title={creating ? 'Create your account' : 'Sign in'}>
      <p className="muted-text">Sign in to share the records with your organization. Everyone sees the same workers, days and payouts, and each phone keeps working without signal. Each person uses their own email and password.</p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={creating ? 'Password (at least 6 characters)' : 'Password'}><input type="password" autoComplete={creating ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && !creating && submit()} /></Field>
        {creating && <Field label="Password again"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>}
      </div>
      {creating && pw2 && pw !== pw2 && <p className="warning-text" style={{ marginTop: 6 }}>The passwords don’t match.</p>}
      <div className="pill-row">
        <button className="primary-button small" disabled={busy || !ok} onClick={submit}>{creating ? 'Create account' : 'Sign in'}</button>
        <button className="outline-button" onClick={() => { setMode(creating ? 'signin' : 'create'); setPw2('') }}>{creating ? 'I already have an account' : 'New here? Create an account'}</button>
      </div>
      {!creating && <p className="muted-text" style={{ marginTop: 10 }}>Forgot your password? Ask whoever set up the organization to reset it in Supabase (Authentication → Users).</p>}
    </Section>
  )
}

function ChangePassword() {
  const toast = useToast()
  const [open, setOpen] = useState(false), [pw, setPw] = useState('')
  if (!open) return <button className="outline-button" onClick={() => setOpen(true)}>Change password</button>
  return (
    <div className="form-grid">
      <Field label="New password (at least 6 characters)"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <div style={{ alignSelf: 'end' }}><button className="primary-button small" disabled={pw.length < 6} onClick={() => changePassword(pw).then(() => { toast('Password changed'); setOpen(false); setPw('') }).catch((e) => toast(e.message, 'error'))}>Save</button></div>
    </div>
  )
}

function ChooseFamily({ status }) {
  const toast = useToast()
  const [fams, setFams] = useState(null), [name, setName] = useState('My organization'), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [creating, setCreating] = useState(false)
  useEffect(() => { listFamilies().then(setFams).catch((e) => { toast(e.message, 'error'); setFams([]) }) }, [])
  const run = (f) => async () => { setBusy(true); try { await f() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) } }
  // joining replaces what is on this phone with the organization's records
  const okToReplace = () => !hasLocalData() || (window.confirm('This phone already has records. Joining replaces them with the organization’s records. Download a backup of this phone first?')
    ? (downloadBackup(), window.confirm('Backup started. Join the organization now?')) : window.confirm('Replace this phone’s records with the organization’s?'))
  if (!fams) return <Loading />
  return (
    <>
      {fams.length > 0 && <Section title="Your organization">
        {fams.map((f) => <div key={f.id} className="pill-row" style={{ alignItems: 'center' }}><strong style={{ flex: 1 }}>{f.name}</strong>
          <button className="primary-button small" disabled={busy} onClick={run(async () => { if (okToReplace()) await openFamily(f.id, f.role) })}>Open</button></div>)}
      </Section>}
      <Section title="Join your organization">
        <p className="muted-text">Enter the invite code from whoever set up the organization (it’s on their Organization screen).</p>
        <div className="form-grid" style={{ marginTop: 12 }}><Field label="Invite code"><input value={code} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code.trim().length >= 6 && run(async () => { if (okToReplace()) await joinFamily(code) })()} /></Field></div>
        <div className="pill-row"><button className="primary-button small" disabled={busy || code.trim().length < 6} onClick={run(async () => { if (okToReplace()) await joinFamily(code) })}>Join</button></div>
      </Section>
      <Section title="Setting it up for the first time?">
        {!creating ? <>
          <p className="muted-text">Only ONE person creates the organization. Everyone else joins with the code.</p>
          <div className="pill-row"><button className="outline-button" onClick={() => setCreating(true)}>Create a new organization</button></div>
        </> : <>
          <p className="muted-text">{hasLocalData() ? 'This phone’s records will be uploaded and become the organization’s records.' : 'You’ll get an invite code to share with the others.'}</p>
          <div className="form-grid" style={{ marginTop: 12 }}><Field label="Organization name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
          <div className="pill-row"><button className="primary-button small" disabled={busy || !name.trim()} onClick={run(() => createFamily(name))}>Create organization</button>
            <button className="outline-button" onClick={() => setCreating(false)}>Cancel</button></div>
        </>}
      </Section>
      <button className="logout-button" onClick={() => signOut()}><Icon name="user" size={18} /> Sign out{status.email ? ` (${status.email})` : ''}</button>
    </>
  )
}

// Shown before the app: sign in / create account, then join or create the organization.
export function AuthGate({ status }) {
  return (
    <main className="auth-screen">
      <div className="auth-brand"><span><Icon name="clock" size={26} /></span><div><strong>Shiftly</strong><small>Work hours &amp; payout</small></div></div>
      {status.state === 'signed-out' ? <SignIn /> : <><p className="auth-step">Signed in as <b>{status.email}</b></p><ChooseFamily status={status} /></>}
    </main>
  )
}

const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)
function Members({ fam }) {
  const toast = useToast()
  const [list, setList] = useState(null)
  const load = () => listMembers(fam.id).then(setList).catch((e) => { toast(e.message, 'error'); setList([]) })
  useEffect(() => { load() }, [fam.id])
  const owner = fam.role === 'owner'
  const remove = (m) => window.confirm(`Remove ${m.email} from ${fam.name}? They will stop seeing and syncing the records. Records they logged stay.`)
    && removeMember(fam.id, m.user_id).then(() => { toast(`${m.email} removed`); load() }).catch((e) => toast(e.message, 'error'))
  return (
    <Section title={`Members${list ? ` (${list.length})` : ''}`}>
      {!list ? <Loading /> : list.map((m) => (
        <div key={m.user_id} className="pill-row" style={{ alignItems: 'center', margin: '0 0 10px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ wordBreak: 'break-all' }}>{m.email}{m.me ? ' (you)' : ''}</strong>
            <p className="muted-text" style={{ margin: 0 }}>{m.role === 'owner' ? 'Owner' : m.role === 'viewer' ? 'Viewer' : 'Member'} · joined {shortDate(m.joined_at)}{m.last_sign_in_at ? ` · last signed in ${shortDate(m.last_sign_in_at)}` : ''}</p>
          </div>
          {owner && !m.me && m.role !== 'owner' && <button className="outline-button danger" onClick={() => remove(m)}>Remove</button>}
        </div>
      ))}
      <p className="muted-text">{owner ? 'Removing someone stops them seeing the records. If they still have the invite code they could join again, so make a new code too.' : 'Only the owner can remove members.'}</p>
    </Section>
  )
}

function Synced({ status }) {
  const toast = useToast()
  const [fam, setFam] = useState(null)
  useEffect(() => { listFamilies().then((fs) => setFam(fs.find((f) => f.id === status.household_id) || null)).catch(() => {}) }, [status.household_id])
  return (
    <>
      <Section title={fam ? fam.name : 'Organization'}>
        <p><strong>{syncLabel(status)}</strong></p>
        <p className="muted-text" style={{ marginTop: 6 }}>{status.state === 'offline'
          ? 'No connection to the server. Everything you enter is saved on this phone and uploads when you’re back online.'
          : 'Changes upload a few seconds after you make them, and other phones’ changes arrive every minute or when you open the app.'}</p>
        {status.rejected?.length > 0 && <div className="alert-banner" style={{ marginTop: 12 }}><span className="alert-icon"><Icon name="alert" size={19} /></span>
          <div><strong>Not saved to the organization copy</strong>{status.rejected.map((r, i) => <p key={i}>{r.message}</p>)}<p>This phone now shows the organization’s version of those records.</p></div></div>}
        <div className="pill-row"><button className="primary-button small" disabled={status.state === 'syncing'} onClick={() => syncNow()}>Sync now</button></div>
      </Section>
      {fam && <Section title="Invite members">
        <p className="muted-text">On their phone: install the app, open Organization, create an account with their own email and password, and enter this code.</p>
        <p style={{ fontSize: 28, letterSpacing: 4, margin: '10px 0' }}><strong>{fam.invite_code}</strong></p>
        {fam.role === 'owner' && <button className="outline-button" onClick={() => newInviteCode(fam.id).then((c) => { setFam({ ...fam, invite_code: c }); toast('New code made; the old one no longer works') }).catch((e) => toast(e.message, 'error'))}>Make a new code</button>}
      </Section>}
      {fam && <Members fam={fam} />}
      <Section title="Your account"><ChangePassword /></Section>
      <button className="logout-button" onClick={() => { if (window.confirm('Sign out? This phone keeps its records but stops syncing.')) signOut() }}><Icon name="user" size={18} /> Sign out</button>
    </>
  )
}

export function FamilyPage() {
  const status = useSyncStatus()
  return (
    <Page title="Organization" eyebrow="Share with your organization">
      {!cloudConfigured ? <Section title="Not set up"><p className="muted-text">This build has no Supabase project. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the .env file and rebuild (see SETUP.md). Until then everything stays on this phone.</p></Section>
        : status.state === 'starting' ? <Loading />
        : status.state === 'signed-out' ? <SignIn />
        : status.state === 'no-family' ? <ChooseFamily status={status} />
        : <Synced status={status} />}
    </Page>
  )
}
