// Turns Messenger-style notes ("sam oct 24 8:30pm-1am ot 2h") into proposed entries.
import { fmtMin } from './calc.js'
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const RANGE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
const to24 = (h, m, ap) => ((+h % 12) + (ap === 'pm' ? 12 : 0)) * 60 + (+m || 0)
function range(str) {
  const x = RANGE.exec(str)
  if (!x) return null
  const [, h1, m1, a1, h2, m2, a2] = x
  let best = null
  for (const p1 of a1 ? [a1.toLowerCase()] : ['am', 'pm'])
    for (const p2 of a2 ? [a2.toLowerCase()] : ['am', 'pm']) {
      const s = to24(h1, m1, p1), e = to24(h2, m2, p2)
      const d = (e - s + 1440) % 1440
      if (d > 0 && (!best || d < best.d)) best = { s, e, d }
    }
  return best && { time_in: fmtMin(best.s), time_out: fmtMin(best.e), hours: best.d / 60 }
}
export function parseNotes(text, workers, year) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const low = line.toLowerCase()
    const w = workers.find((x) => new RegExp(`\\b${x.name.toLowerCase()}\\b`).test(low))
    let date = null
    const dm = new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s*-?\\s*(\\d{1,2})\\b`).exec(low)
    const sm = /\b(\d{1,2})\/(\d{1,2})\b/.exec(low)
    if (dm) date = [MONTHS.indexOf(dm[1]) + 1, +dm[2]]
    else if (sm) date = [+sm[1], +sm[2]]
    const iso = date ? `${year}-${String(date[0]).padStart(2, '0')}-${String(date[1]).padStart(2, '0')}` : null
    const [main, ...otParts] = line.split(/\bot\b/i)
    const mainNoDate = main.replace(dm?.[0] || sm?.[0] || '', ' ')
    const status = /\brd\b/i.test(main) ? 'rd' : /training/i.test(main) ? 'training' : 'worked'
    const r = status === 'rd' ? null : range(mainNoDate)
    let ot = 0
    if (otParts.length) {
      const o = otParts.join(' ')
      const h = /(\d+(?:\.\d+)?)\s*h/i.exec(o)
      const rr = range(o)
      ot = h ? +h[1] : rr ? rr.hours : 0
    }
    const ok = !!(w && iso && (status === 'rd' || r))
    return {
      line, ok, worker_id: w?.id ?? null, worker: w?.name ?? null, date: iso, status,
      time_in: r?.time_in ?? null, time_out: r?.time_out ?? null, ot_hours: ot,
      error: ok ? null : !w ? 'No worker name found' : !iso ? 'No date found' : 'No time range found',
    }
  })
}
