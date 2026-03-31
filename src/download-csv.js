import Papa from 'papaparse'

const COMBINING_MARK_REGEX = /\p{M}/u
const COMBINING_MARKS_GLOBAL_REGEX = /\p{M}/gu

function countCombiningMarks(value) {
  let totalCodePoints = 0
  let totalMarks = 0
  let maxConsecutiveMarks = 0
  let consecutiveMarks = 0

  for (const char of value.normalize('NFD')) {
    totalCodePoints += 1

    if (COMBINING_MARK_REGEX.test(char)) {
      consecutiveMarks += 1
      totalMarks += 1
      maxConsecutiveMarks = Math.max(maxConsecutiveMarks, consecutiveMarks)
      continue
    }

    consecutiveMarks = 0
  }

  return {
    totalCodePoints,
    totalMarks,
    maxConsecutiveMarks
  }
}

export function shouldStripPathologicalCombiningMarks(value) {
  if (typeof value !== 'string' || value === '') return false

  const { totalCodePoints, totalMarks, maxConsecutiveMarks } = countCombiningMarks(value)

  if (totalMarks < 8 || totalCodePoints === 0) return false

  return maxConsecutiveMarks >= 3 && (totalMarks / totalCodePoints) >= 0.15
}

export function normalizeCsvCellValue(value) {
  if (value === null || value === undefined) return ''

  const normalizedValue = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  if (!shouldStripPathologicalCombiningMarks(normalizedValue)) {
    return normalizedValue
  }

  // Strip pathological combining-mark spam while preserving the readable base text.
  return normalizedValue
    .normalize('NFD')
    .replace(COMBINING_MARKS_GLOBAL_REGEX, '')
    .normalize('NFC')
}

export function buildCsvString(headers, rows) {
  const data = [
    headers.map(header => normalizeCsvCellValue(header)),
    ...rows.map(row => row.map(cell => normalizeCsvCellValue(cell)))
  ]

  return Papa.unparse(data, {
    newline: '\r\n',
    escapeFormulae: true
  })
}

export default function downloadCsv(filename, headers, rows) {
  const csvString = buildCsvString(headers, rows)

  const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'data.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
