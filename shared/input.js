// Quick-entry parsers used by the Daily Log (kept separate so they can be tested).

// "4", "4.5", "4:30", "4h30", "4h 30m", "45m" -> hours (or null)
export function parseHours(text) {
  const t = String(text).trim().toLowerCase()
  let x
  if ((x = /^(\d+(?:\.\d+)?)$/.exec(t))) return +x[1]
  if ((x = /^(\d+):(\d{1,2})$/.exec(t))) return +x[1] + +x[2] / 60
  if ((x = /^(\d+)\s*h(?:rs?|ours?)?\s*(?:(\d{1,2})\s*(?:m(?:in)?s?)?)?$/.exec(t))) return +x[1] + (x[2] ? +x[2] / 60 : 0)
  if ((x = /^(\d+)\s*m(?:in)?s?$/.exec(t))) return +x[1] / 60
  return null
}

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// "11/7", "nov 7", "7 nov", "7" (day of the month being viewed), "2026-11-07" -> ISO date, or null.
// `ref` is the ISO date currently shown; it supplies the missing month/year.
export function parseDateInput(text, ref) {
  const t = String(text).trim().toLowerCase()
  if (!t) return null
  let y = +ref.slice(0, 4), m = +ref.slice(5, 7), d, x
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) { y = +x[1]; m = +x[2]; d = +x[3] }
  else if ((x = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/.exec(t))) { m = +x[1]; d = +x[2]; if (x[3]) y = x[3].length === 2 ? 2000 + +x[3] : +x[3] }
  else if ((x = new RegExp(`^(${MON.join('|')})[a-z]*\\.?\\s*(\\d{1,2})(?:,?\\s*(\\d{4}))?$`).exec(t))) { m = MON.indexOf(x[1]) + 1; d = +x[2]; if (x[3]) y = +x[3] }
  else if ((x = new RegExp(`^(\\d{1,2})\\s*(${MON.join('|')})[a-z]*(?:\\s*(\\d{4}))?$`).exec(t))) { d = +x[1]; m = MON.indexOf(x[2]) + 1; if (x[3]) y = +x[3] }
  else if ((x = /^(\d{1,2})$/.exec(t))) d = +x[1]
  else return null
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const dt = new Date(iso + 'T00:00:00Z')
  return !isNaN(dt) && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d ? iso : null
}
