import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

import { getEngine, storageInfo, subscribe } from './storage.js'
import { saveFile } from './native.js'
export { storageInfo }

// Same call shape as the old server API, but answered by the engine inside the browser.
export async function api(path, { method = 'GET', body } = {}) {
  return getEngine().handle(method, path, body)
}

const save = (blob, name) => saveFile(blob, name)   // browser download, or the share sheet in the app
export async function downloadExport(month, { workers = null, summary = true, ot = true, daily = true, weekday = true } = {}) {
  const [{ buildWorkbook, exportName }] = await Promise.all([import('../../shared/export.js')])
  const ctx = getEngine().exportCtx(month, workers)
  if (!ctx.workers.length) throw new Error('No workers selected')
  const buf = await buildWorkbook(ctx, { summary, otSummary: ot, daily, weekday })
  return save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(month))
}
export function downloadBackup() {
  const { filename, json } = getEngine().backup()
  return save(new Blob([json], { type: 'application/json' }), filename)
}
// with family sync on, these only change THIS phone: the next sync merges with the family copy
export const restoreBackup = async (text) => { const r = getEngine().restore(text); (await import('./cloud.js')).forgetSyncedState(); return r }
export const eraseAll = async () => { getEngine().reset(); (await import('./cloud.js')).forgetSyncedState() }
export const loadDemo = () => getEngine().loadDemo()

// live: reload by itself when another phone's changes arrive. Screens with a form the user may be
// typing in pass live: false and get `stale: true` instead, so nothing is overwritten under them.
export function useLoad(url, { live = true } = {}) {
  const [s, set] = useState({ loading: true, data: null, error: null, stale: false })
  const run = useCallback(() => {
    if (!url) return set({ loading: false, data: null, error: null, stale: false })
    api(url).then((d) => set({ loading: false, data: d, error: null, stale: false })).catch((e) => set({ loading: false, data: null, error: e.message, stale: false }))
  }, [url])
  useEffect(() => { set((x) => ({ ...x, loading: true })); run() }, [run])
  useEffect(() => subscribe((info) => { if (info?.remote) live ? run() : set((x) => ({ ...x, stale: true })) }), [run, live])
  return { ...s, reload: run }
}

export const $ = (n) => '$' + (Number(n) || 0).toFixed(2)
export const h2 = (n) => (Number(n) || 0).toFixed(2)
export const t12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` }
const iso = (d) => d.toISOString().slice(0, 10)
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
export const addMonths = (m, n) => { const [y, mm] = m.split('-').map(Number); return iso(new Date(Date.UTC(y, mm - 1 + n, 1))).slice(0, 7) }
export const fmtDate = (s, o = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...o })
export const monthLabel = (m) => fmtDate(m + '-01', { month: 'long', year: 'numeric' })
export const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Manila' }).format(new Date())
export const STATUS = { worked: 'Worked', rd: 'Rest day', not_worked: 'Not worked', training: 'Training', not_logged: 'Not logged' }
