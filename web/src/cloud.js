// Organization: Supabase sign-in, the organization (household) this phone belongs to, and when to sync.
// Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app still works, on this phone only.
import { createClient } from '@supabase/supabase-js'
import { createSync } from './sync.js'
import { getEngine, persist, subscribe } from './storage.js'

const URL = import.meta.env.VITE_SUPABASE_URL, KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const cloudConfigured = !!(URL && KEY)
export const supabase = cloudConfigured
  ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null

const META_KEY = 'wh-sync'
const loadMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY)) || {} } catch { return {} } }
const saveMeta = (m) => { try { localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* full or blocked */ } }
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data }

let sync = null, cleanup = []
let status = { state: cloudConfigured ? 'starting' : 'off' }
const listeners = new Set()
const emit = (s) => { status = { ...status, ...s }; listeners.forEach((f) => f(status)) }
export const onSyncStatus = (f) => { listeners.add(f); f(status); return () => listeners.delete(f) }
export const syncStatus = () => status

export const syncNow = () => sync?.sync()

function stopSync() {
  cleanup.forEach((f) => f()); cleanup = []; sync = null
  getEngine()?.setRole?.(null)
}

// this login's role in the organization ('owner' | 'editor' | 'viewer'): remembered for offline use,
// refreshed from the server whenever possible (the owner may have removed someone)
function applyRole(meta, role) {
  if (role !== meta.role) { meta.role = role; saveMeta(meta) }
  getEngine().setRole(role || 'editor')
  emit({ role: role || 'editor' })
}
async function refreshRole(meta) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const rows = must(await supabase.from('household_members').select('role').eq('household_id', meta.household_id).eq('user_id', user.id))
    applyRole(meta, rows[0]?.role || 'viewer')            // no row: removed from the organization → read only
  } catch { /* offline: keep the remembered role */ }
}

function startSync(meta) {
  stopSync()
  sync = createSync({ client: supabase, getState: () => getEngine().state, persist: (S) => persist(S, { remote: true }), meta, saveMeta })
  cleanup.push(sync.onStatus((s) => emit({ ...s, household_id: meta.household_id })))
  emit({ ...sync.status(), household_id: meta.household_id })
  applyRole(meta, meta.role)
  refreshRole(meta)
  // when to sync: shortly after every change made here, every minute while open,
  // when the phone gets signal back, and when the app comes back to the front
  let t = null
  cleanup.push(subscribe((info) => { if (!info?.remote) { clearTimeout(t); t = setTimeout(syncNow, 2500) } }))
  const iv = setInterval(() => document.visibilityState === 'visible' && syncNow(), 60_000)
  const vis = () => document.visibilityState === 'visible' && syncNow()
  window.addEventListener('online', syncNow); document.addEventListener('visibilitychange', vis)
  cleanup.push(() => { clearTimeout(t); clearInterval(iv); window.removeEventListener('online', syncNow); document.removeEventListener('visibilitychange', vis) })
  syncNow()
}

// called once when the app opens (after the local data is loaded)
// A phone that already belongs to a organization always opens into the app, even with no signal
// (the saved login may need the network to refresh); it only asks to sign in again when it
// is online and the login is really gone.
export async function startCloud() {
  if (!supabase) return
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { stopSync(); emit({ state: 'signed-out', household_id: null }) } })
  const meta = loadMeta()
  let session = null
  try { session = (await supabase.auth.getSession()).data.session } catch { /* offline or storage blocked */ }
  if (meta.household_id && (session || !navigator.onLine)) return startSync(meta)
  if (meta.household_id && !session) saveMeta({})            // online but signed out: start over
  emit({ state: session ? 'no-family' : 'signed-out', email: session?.user?.email, household_id: null })
}

// ── sign-in with email + password (Supabase sends no emails: "Confirm email" is off) ──
const friendly = (m) => /invalid login credentials/i.test(m) ? 'Wrong email or password.'
  : /already registered|already exists/i.test(m) ? 'That email already has an account. Use “Sign in” instead.'
  : /password should be at least/i.test(m) ? 'Use a password of at least 6 characters.' : m
const auth = async (p) => { const { data, error } = await p; if (error) throw new Error(friendly(error.message)); return data }
async function signedIn(d) {
  if (!d.session) throw new Error('The account was created but needs email confirmation. Turn off "Confirm email" in Supabase (Authentication → Sign In / Providers → Email).')
  emit({ state: 'no-family', email: d.user?.email })
}
export async function signIn(email, password) { await signedIn(await auth(supabase.auth.signInWithPassword({ email: email.trim(), password }))) }
export async function createAccount(email, password) { await signedIn(await auth(supabase.auth.signUp({ email: email.trim(), password }))) }
export async function changePassword(password) { await auth(supabase.auth.updateUser({ password })) }
export async function signOut() { stopSync(); saveMeta({}); await supabase.auth.signOut(); emit({ state: 'signed-out', household_id: null }) }

// ── organizations ──
export async function listFamilies() {
  const { data: { user } } = await supabase.auth.getUser()
  const rows = must(await supabase.from('household_members').select('role, households(id, name, invite_code)').eq('user_id', user.id))
  return rows.map((r) => ({ ...r.households, role: r.role }))
}
// first phone: this phone's existing data becomes the organization's data
export async function createFamily(name) {
  const id = must(await supabase.rpc('create_household', { p_name: name.trim(), p_timezone: getEngine().state.settings.timezone }))
  const meta = { household_id: id, role: 'owner' }; saveMeta(meta); startSync(meta)
  return id
}
// other phones: this phone's data is replaced by the organization's
async function useFamily(id, role) {
  getEngine().reset()
  const meta = { household_id: id, role }; saveMeta(meta); startSync(meta)
}
export async function joinFamily(code) { await useFamily(must(await supabase.rpc('join_household', { p_code: code })), 'editor') }
export const openFamily = (id, role) => useFamily(id, role)
// who is in the organization (email, role, joined, last active); `me` marks this login
export async function listMembers(id) {
  const [{ data: { user } }, rows] = await Promise.all([supabase.auth.getUser(), supabase.rpc('list_members', { p_household: id }).then(must)])
  return rows.map((r) => ({ ...r, me: r.user_id === user?.id }))
}
export async function removeMember(id, userId) { must(await supabase.rpc('remove_member', { p_household: id, p_user: userId })) }
export async function newInviteCode(id) { return must(await supabase.rpc('new_invite_code', { p_household: id })) }

// after "Erase all" or "Restore backup": forget what was uploaded, so the next sync MERGES with
// the organization copy instead of deleting the organization's records to match this phone
export function forgetSyncedState() {
  const m = loadMeta()
  if (!m.household_id) return
  const fresh = { household_id: m.household_id, role: m.role }
  saveMeta(fresh)
  if (sync) startSync(fresh)
}
