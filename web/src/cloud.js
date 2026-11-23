// Family sync: Supabase sign-in, the family (household) this phone belongs to, and when to sync.
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
}

function startSync(meta) {
  stopSync()
  sync = createSync({ client: supabase, getState: () => getEngine().state, persist: (S) => persist(S, { remote: true }), meta, saveMeta })
  cleanup.push(sync.onStatus((s) => emit({ ...s, household_id: meta.household_id })))
  emit({ ...sync.status(), household_id: meta.household_id })
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
export async function startCloud() {
  if (!supabase) return
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { stopSync(); emit({ state: 'signed-out' }) } })
  const { data: { session } } = await supabase.auth.getSession()
  const meta = loadMeta()
  if (session && meta.household_id) startSync(meta)
  else emit({ state: session ? 'no-family' : 'signed-out', email: session?.user?.email })
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

// ── families ──
export async function listFamilies() {
  const { data: { user } } = await supabase.auth.getUser()
  const rows = must(await supabase.from('household_members').select('role, households(id, name, invite_code)').eq('user_id', user.id))
  return rows.map((r) => ({ ...r.households, role: r.role }))
}
// first phone: this phone's existing data becomes the family's data
export async function createFamily(name) {
  const id = must(await supabase.rpc('create_household', { p_name: name.trim(), p_timezone: getEngine().state.settings.timezone }))
  const meta = { household_id: id }; saveMeta(meta); startSync(meta)
  return id
}
// other phones: this phone's data is replaced by the family's
async function useFamily(id) {
  getEngine().reset()
  const meta = { household_id: id }; saveMeta(meta); startSync(meta)
}
export async function joinFamily(code) { await useFamily(must(await supabase.rpc('join_household', { p_code: code }))) }
export const openFamily = (id) => useFamily(id)
export async function newInviteCode(id) { return must(await supabase.rpc('new_invite_code', { p_household: id })) }

// after "Erase all" or "Restore backup": forget what was uploaded, so the next sync MERGES with
// the family copy instead of deleting the family's records to match this phone
export function forgetSyncedState() {
  const m = loadMeta()
  if (!m.household_id) return
  const fresh = { household_id: m.household_id }
  saveMeta(fresh)
  if (sync) startSync(fresh)
}
