import ExcelJS from 'exceljs'
import { monthReport, evalOffers, daysInMonth, r2, toMin, fmtMin } from './calc.js'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const COL = { grey: 'FFD9D9D9', green: 'FFB6D7A8', pink: 'FFEA9999', yellow: 'FFFFF2CC' }
const thin = { style: 'thin', color: { argb: 'FF000000' } }
const BOX = { top: thin, left: thin, bottom: thin, right: thin }
const CUR = '"$"#,##0.00'
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const L = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const NOTE = { worked: 'Regular', training: 'Training', rd: 'RD', not_worked: 'Regular', not_logged: 'Regular' }
export const monthTitle = (month) => `${MONTH_NAMES[+month.slice(5) - 1]} ${month.slice(0, 4)}`
export const exportName = (month) => `${MONTH_NAMES[+month.slice(5) - 1]} Invoice.xlsx`
const sheetName = (w, m) => `${w.name} - ${MON[m - 1]}`.replace(/[[\]:*?/\\]/g, '').slice(0, 31)
const t12 = (t) => { const m = toMin(t); const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` }

function cell(ws, ref, value, o = {}) {
  const c = ws.getCell(ref)
  c.value = value
  if (o.fmt) c.numFmt = o.fmt
  if (o.bold || o.size) c.font = { name: 'Arial', size: o.size || 11, bold: !!o.bold, color: o.color ? { argb: o.color } : undefined }
  if (o.fill) c.fill = solid(o.fill)
  if (o.box) c.border = BOX
  c.alignment = { horizontal: o.align || 'center', vertical: 'middle', wrapText: !!o.wrap }
  return c
}

export async function buildWorkbook(ctx, opts = {}) {
  const o = { summary: true, otSummary: true, daily: true, weekday: true, ...opts }
  const { month, workers, offers, today } = ctx
  const m = +month.slice(5)
  const dates = daysInMonth(month)
  const n = dates.length, t = n + 2, s0 = n + 4
  const { report } = monthReport({ month, workers, rates: ctx.rates, entries: ctx.entries, offers, bonuses: ctx.bonuses, today, lunch: ctx.lunch, accountDays: ctx.accountDays })
  const names = Object.fromEntries(workers.map((w) => [w.id, sheetName(w, m)]))
  const q = (w) => `'${names[w.id]}'`

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Work Hours & Payout Tracker'
  wb.calcProperties.fullCalcOnLoad = true
  const sumWs = o.summary ? wb.addWorksheet('Summary', { views: [{ showGridLines: false }], properties: { tabColor: { argb: 'FF7F7F7F' } } }) : null

  for (const w of workers) {
    const r = report[w.id]
    const ws = wb.addWorksheet(names[w.id], {
      properties: { tabColor: { argb: 'FF' + (w.color || '#4169A1').replace('#', '') } },
      views: [{ state: 'frozen', ySplit: 1 }],
    })
    const widths = [17, 11, 11, 12, 18, 13, 13, 12, 11, 18, 14, 32, 3, 13, 30, 20, 14]
    widths.forEach((x, i) => (ws.getColumn(i + 1).width = x))
    ;[['A','Date'],['B','Time In'],['C','Time Out'],['D','Total Hours'],['E','Hourly Rate (USD)'],['F','Total Pay'],['G','Notes'],['H','Paid lunch (min)'],
      ['I','OT Hours'],['J','Hourly Rate (USD)'],['K','Total Pay'],['L','Remarks'],['N','Review Date'],['O','Reference'],['P','Note'],['Q','Bonus (USD)']]
      .forEach(([c, txt]) => cell(ws, c + 1, txt, { bold: true, fill: COL.grey, box: true, wrap: true }))
    ws.getRow(1).height = 30

    r.rows.forEach((row, i) => {
      const x = i + 2
      const timed = row.status === 'worked' || row.status === 'training'
      cell(ws, 'A' + x, new Date(row.date + 'T00:00:00Z'), { fmt: o.weekday ? 'ddd mmm-dd-yyyy' : 'mmm-dd-yyyy', box: true })
      cell(ws, 'B' + x, timed ? toMin(row.time_in) / 1440 : null, { fmt: 'h:mm AM/PM', box: true })
      cell(ws, 'C' + x, timed ? toMin(row.time_out) / 1440 : null, { fmt: 'h:mm AM/PM', box: true })
      cell(ws, 'D' + x, { formula: `IF(OR(G${x}="RD",B${x}="",C${x}=""),0,MOD(C${x}-B${x},1)*24+H${x}/60)`, result: row.hours }, { fmt: '0.00', box: true })
      cell(ws, 'E' + x, row.rate, { fmt: CUR, box: true })
      cell(ws, 'F' + x, { formula: `ROUND(D${x}*E${x},2)`, result: row.pay }, { fmt: CUR, box: true })
      cell(ws, 'G' + x, NOTE[row.status], { box: true })
      cell(ws, 'H' + x, row.lunchMin > 0 ? row.lunchMin : null, { box: true })
      ws.getCell('G' + x).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Regular,RD,Training"'], showErrorMessage: true, errorTitle: 'Notes', error: 'Choose Regular, RD or Training' }
      const offer = offers.find((f) => f.start_date <= row.date && row.date <= f.end_date)
      const fill = offer ? COL.yellow : undefined
      cell(ws, 'I' + x, row.ot_hours || null, { fmt: '0.00', box: true, fill })
      cell(ws, 'J' + x, row.ot_hours ? row.otRate : null, { fmt: CUR, box: true, fill })
      cell(ws, 'K' + x, { formula: `ROUND(I${x}*J${x},2)`, result: row.otPay }, { fmt: CUR, box: true, fill })
      if (offer) ws.getCell('I' + x).dataValidation = { type: 'decimal', operator: 'between', formulae: [0, offer.cap_hours], allowBlank: true, showErrorMessage: true, error: `OT is capped at ${offer.cap_hours} h per shift` }
      const bits = []
      if (row.ot_hours && row.ot_start) bits.push(`OT ${t12(row.ot_start)} to ${t12(row.ot_end)}${row.provisional ? ' (provisional)' : ''}`)
      if (row.override) bits.push(`Rate override: ${row.reason}`)
      if (row.remark) bits.push(row.remark)
      cell(ws, 'L' + x, bits.join('; ') || null, { box: true, align: 'left' })
    })
    ws.addConditionalFormatting({ ref: `B2:C${n + 1}`, rules: [
      { type: 'expression', priority: 1, formulae: ['$G2="RD"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COL.grey } } } },
      { type: 'expression', priority: 2, formulae: ['$G2="Training"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COL.green } } } },
    ] })

    // totals row (same position as the original workbook)
    ws.mergeCells(`A${t}:E${t}`)
    cell(ws, 'A' + t, 'TOTAL MONTHLY PAY', { bold: true, align: 'right' })
    cell(ws, 'F' + t, { formula: `SUM(F2:F${n + 1})`, result: r.regularPay }, { bold: true, fill: COL.pink, fmt: CUR, box: true })
    cell(ws, 'I' + t, { formula: `SUM(I2:I${n + 1})`, result: r.otHours }, { bold: true, fmt: '0.00', box: true })
    cell(ws, 'J' + t, 'GRAND TOTAL', { bold: true, align: 'right' })
    cell(ws, 'K' + t, { formula: `F${t}+SUM(K2:K${n + 1})+SUM(Q2:Q200)`, result: r.total }, { bold: true, size: 14, fmt: CUR, box: true })
    ws.getCell('K' + t).border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } }
    ws.getRow(t).height = 22

    // summary block
    const block = [
      ['Days worked', `COUNTIF(D2:D${n + 1},">0")`, r.shifts, '0'],
      ['Total hours', `SUM(D2:D${n + 1})`, r.regularHours, '0.00'],
      ['Rest days', `COUNTIF(G2:G${n + 1},"RD")`, r.restDays, '0'],
      ['Training hours', `SUMIF(G2:G${n + 1},"Training",D2:D${n + 1})`, r.trainingHours, '0.00'],
      ['Regular pay', `F${t}`, r.regularPay, CUR],
      ['OT pay', `SUM(K2:K${n + 1})`, r.otPay, CUR],
      ['Review bonuses', `SUM(Q2:Q200)`, r.bonusTotal, CUR],
      ['Grand total', `K${t}`, r.total, CUR],
    ]
    block.forEach(([label, f, res, fmt], i) => {
      const x = s0 + i
      ws.mergeCells(`A${x}:B${x}`)
      cell(ws, 'A' + x, label, { bold: true, fill: COL.grey, box: true, align: 'left' })
      ws.getCell('B' + x).border = BOX
      cell(ws, 'C' + x, { formula: f, result: res }, { fmt, box: true, bold: label === 'Grand total' })
    })
    cell(ws, `D${s0 + 6}`, { formula: 'COUNT(Q2:Q200)&" reviews"', result: `${r.bonuses.length} reviews` }, { align: 'left' })

    // review bonus table
    ;[...r.bonuses].sort((a, b) => a.review_date.localeCompare(b.review_date)).forEach((b, i) => {
      const x = i + 2
      cell(ws, 'N' + x, new Date(b.review_date + 'T00:00:00Z'), { fmt: 'mmm-dd-yyyy', box: true })
      cell(ws, 'O' + x, b.reference || null, { box: true, align: 'left' })
      cell(ws, 'P' + x, b.note || null, { box: true, align: 'left' })
      cell(ws, 'Q' + x, b.amount, { fmt: CUR, box: true })
    })
    ws.autoFilter = `A1:G${n + 1}`
    ws.pageSetup = { printArea: `A1:L${s0 + block.length}` }
    ws.pageSetup = { printArea: `A1:L${s0 + block.length}`, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
    ws.headerFooter.oddFooter = '&L&A&RPage &P of &N'
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell((c) => { c.font = { name: 'Arial', size: 11, ...c.font } }))
  }

  if (sumWs) {
    sumWs.mergeCells('A1:I1')
    cell(sumWs, 'A1', `${monthTitle(month)} Invoice`, { bold: true, size: 14, align: 'left' })
    ;['Worker','Days Worked','Total Hours','Regular Pay','OT Hours','OT Pay','Review Bonus','Grand Total','Status']
      .forEach((h, i) => cell(sumWs, L(i + 1) + 3, h, { bold: true, fill: COL.grey, box: true, wrap: true }))
    ;[18, 13, 13, 15, 12, 14, 15, 16, 18].forEach((x, i) => (sumWs.getColumn(i + 1).width = x))
    workers.forEach((w, i) => {
      const r = report[w.id], x = i + 4, S = q(w)
      const paidAt = ctx.paid?.[w.id]
      cell(sumWs, 'A' + x, w.name, { box: true, align: 'left' })
      cell(sumWs, 'B' + x, { formula: `${S}!C${s0}`, result: r.shifts }, { box: true, fmt: '0' })
      cell(sumWs, 'C' + x, { formula: `${S}!C${s0 + 1}`, result: r.regularHours }, { box: true, fmt: '0.00' })
      cell(sumWs, 'D' + x, { formula: `${S}!F${t}`, result: r.regularPay }, { box: true, fmt: CUR })
      cell(sumWs, 'E' + x, { formula: `${S}!I${t}`, result: r.otHours }, { box: true, fmt: '0.00' })
      cell(sumWs, 'F' + x, { formula: `${S}!C${s0 + 5}`, result: r.otPay }, { box: true, fmt: CUR })
      cell(sumWs, 'G' + x, { formula: `${S}!C${s0 + 6}`, result: r.bonusTotal }, { box: true, fmt: CUR })
      cell(sumWs, 'H' + x, { formula: `${S}!K${t}`, result: r.total }, { box: true, fmt: CUR, bold: true })
      cell(sumWs, 'I' + x, paidAt ? `Paid on ${paidAt.slice(0, 10)}` : 'Unpaid', { box: true })
    })
    const tr = workers.length + 4
    cell(sumWs, 'A' + tr, 'TOTAL', { bold: true, fill: COL.pink, box: true, align: 'left' })
    ;[['B','shifts','0'],['C','regularHours','0.00'],['D','regularPay',CUR],['E','otHours','0.00'],['F','otPay',CUR],['G','bonusTotal',CUR],['H','total',CUR]].forEach(([c, k, fmt]) => {
      const res = workers.reduce((s, w) => s + report[w.id][k], 0)
      cell(sumWs, c + tr, { formula: `SUM(${c}4:${c}${tr - 1})`, result: k.includes('Pay') || k === 'total' || k === 'bonusTotal' ? r2(res) : res }, { bold: true, fill: COL.pink, box: true, fmt })
    })
    sumWs.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    sumWs.eachRow({ includeEmpty: false }, (row) => row.eachCell((c) => { c.font = { name: 'Arial', size: 11, ...c.font } }))
  }

  if (o.otSummary) {
    const inMonth = offers.filter((f) => f.start_date <= dates[n - 1] && f.end_date >= dates[0])
    if (inMonth.length) {
      const ws = wb.addWorksheet('OT Summary', { views: [{ showGridLines: false }] })
      const { stats, byEntry } = evalOffers(inMonth, ctx.entries, ctx.rates, today)
      ;['Offer','Window','Max h / shift','Min total h','Qualified rate','Tier mode','Pooled hours','Status','Worker','OT hours','OT pay']
        .forEach((h, i) => { cell(ws, L(i + 1) + 1, h, { bold: true, fill: COL.grey, box: true, wrap: true }); ws.getColumn(i + 1).width = [22, 24, 13, 12, 14, 11, 13, 22, 16, 11, 13][i] })
      let x = 2
      for (const f of inMonth) {
        const st = stats[f.id]
        const status = `${st.final ? 'Final' : 'Provisional'}${st.qualified ? ', minimum reached' : `, ${st.remaining}h to minimum`}`
        for (const w of workers) {
          const es = ctx.entries.filter((e) => e.ot_offer_id === f.id && e.worker_id === w.id && e.ot_hours > 0)
          const hrs = es.reduce((s, e) => s + e.ot_hours, 0), pay = r2(es.reduce((s, e) => s + (byEntry[e.id]?.otPay || 0), 0))
          const vals = [f.name, `${f.start_date} to ${f.end_date}`, f.cap_hours, f.min_hours, f.qualified_rate, f.tier_mode, st.total, status, w.name, hrs, pay]
          const fmts = [null, null, '0.00', '0.00', CUR, null, '0.00', null, null, '0.00', CUR]
          vals.forEach((v, i) => cell(ws, L(i + 1) + x, v, { box: true, fmt: fmts[i] || undefined, align: i < 2 || i === 7 ? 'left' : 'center' }))
          x++
        }
      }
      ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      ws.eachRow({ includeEmpty: false }, (row) => row.eachCell((c) => { c.font = { name: 'Arial', size: 11, ...c.font } }))
    }
  }

  if (o.daily) {
    const ws = wb.addWorksheet('Account Daily', { views: [{ state: 'frozen', ySplit: 1 }] })
    const nW = workers.length, cF = 2 + nW
    cell(ws, 'A1', 'Date', { bold: true, fill: COL.grey, box: true })
    workers.forEach((w, j) => cell(ws, L(2 + j) + 1, `${w.name} paid hrs`, { bold: true, fill: COL.grey, box: true, wrap: true }))
    ;['Paid Hrs (incl. lunch)','Of which lunch Hrs','Account OT Hrs','Company Recorded Hrs','Difference','Remarks'].forEach((h, k) => cell(ws, L(cF + k) + 1, h, { bold: true, fill: COL.grey, box: true, wrap: true }))
    ws.getColumn(1).width = 17
    for (let c = 2; c <= cF + 5; c++) ws.getColumn(c).width = c === cF + 5 ? 28 : 14
    ws.getRow(1).height = 32
    let totPaid = 0, totLunch = 0, totOt = 0
    dates.forEach((d, i) => {
      const x = i + 2, ad = ctx.accountDays?.[d]
      cell(ws, 'A' + x, new Date(d + 'T00:00:00Z'), { fmt: o.weekday ? 'ddd mmm-dd-yyyy' : 'mmm-dd-yyyy', box: true })
      let paid = 0, lunch = 0, ot = 0
      workers.forEach((w, j) => { const row = report[w.id].rows[i]; paid += row.hours; lunch += row.lunchMin / 60; ot += row.ot_hours; cell(ws, L(2 + j) + x, { formula: `${q(w)}!D${x}`, result: row.hours }, { fmt: '0.00', box: true }) })
      totPaid += paid; totLunch += lunch; totOt += ot
      cell(ws, L(cF) + x, { formula: `SUM(B${x}:${L(1 + nW)}${x})`, result: paid }, { fmt: '0.00', box: true, bold: true })
      cell(ws, L(cF + 1) + x, { formula: `(${workers.map((w) => `N(${q(w)}!H${x})`).join('+')})/60`, result: lunch }, { fmt: '0.00', box: true })
      cell(ws, L(cF + 2) + x, { formula: workers.map((w) => `${q(w)}!I${x}`).join('+'), result: ot }, { fmt: '0.00', box: true })
      const ch = ad?.company_hours ?? null
      cell(ws, L(cF + 3) + x, ch, { fmt: '0.00', box: true })
      // paid hours already include the paid lunch, which is what the company shows for the whole shift
      cell(ws, L(cF + 4) + x, { formula: `IF(${L(cF + 3)}${x}="","",${L(cF)}${x}-${L(cF + 3)}${x})`, result: ch == null ? '' : r2(paid - ch) }, { fmt: '0.00', box: true })
      cell(ws, L(cF + 5) + x, lunch > 0 ? `Paid lunch ${r2(lunch * 60)} min shared` : ad?.lunch_hours ? `Lunch noted: ${ad.lunch_hours} h` : null, { box: true, align: 'left' })
    })
    const tx = n + 2
    cell(ws, 'A' + tx, 'TOTAL', { bold: true, fill: COL.pink, box: true })
    ;[[cF, totPaid], [cF + 1, totLunch], [cF + 2, totOt]].forEach(([c, v]) => cell(ws, L(c) + tx, { formula: `SUM(${L(c)}2:${L(c)}${n + 1})`, result: r2(v) }, { bold: true, fill: COL.pink, fmt: '0.00', box: true }))
    const dc = L(cF + 4)
    ws.addConditionalFormatting({ ref: `${dc}2:${dc}${n + 1}`, rules: [{ type: 'expression', priority: 1, formulae: [`AND(ISNUMBER(${dc}2),${dc}2<>0)`], style: { font: { color: { argb: 'FFC00000' }, bold: true } } }] })
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' }
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell((c) => { c.font = { name: 'Arial', size: 11, ...c.font } }))
  }

  return wb.xlsx.writeBuffer()
}
