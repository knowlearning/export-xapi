import Papa from 'papaparse'

export default function downloadCsv(filename, headers, rows) {
  // Combine headers and rows into an array of arrays
  const data = [headers, ...rows]

  // Generate CSV string
  const csvString = Papa.unparse(data)

  // Optional: add BOM for Excel compatibility
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