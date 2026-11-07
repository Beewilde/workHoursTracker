// Saves the app's data on this device. Every change is written immediately to IndexedDB and mirrored
// to localStorage (which is synchronous, so a change survives even if the tab is closed right away).
import { createEngine, EMPTY } from './engine.js'

const DB = 'work-hours', STORE = 'kv'
let dbp = null
const db = () => (dbp ||= new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }))
const idbGet = async (k) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error) }) }
const idbSet = async (k, v) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error) }) }

export const storageInfo = { mode: 'memory', persisted: false }
let engine = null, idbOk = false, lsOk = false
const listeners = new Set()
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const getEngine = () => engine
const mode = () => { storageInfo.mode = idbOk ? 'idb' : lsOk ? 'local' : 'memory' }

function persist(state) {
  state.savedAt = Date.now()
  if (lsOk) { try { localStorage.setItem('wh-state', JSON.stringify(state)) } catch { lsOk = false; mode() } }
  if (idbOk) idbSet('state', JSON.parse(JSON.stringify(state))).catch(() => { idbOk = false; mode() })
  listeners.forEach((f) => f())
}

export async function initEngine() {
  let a = null, b = null
  try { await idbSet('probe', 1); idbOk = true; a = await idbGet('state') } catch { idbOk = false }
  try { localStorage.setItem('wh-probe', '1'); lsOk = true; const t = localStorage.getItem('wh-state'); b = t ? JSON.parse(t) : null } catch { lsOk = false }
  mode()
  try { storageInfo.persisted = (await navigator.storage?.persist?.()) || false } catch { /* not supported */ }
  const saved = [a, b].filter((x) => x && x.workers).sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0))[0]
  engine = createEngine(saved ? { ...EMPTY(), ...saved } : EMPTY(), persist)
  return engine
}
