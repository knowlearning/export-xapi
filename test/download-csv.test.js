import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCsvString,
  normalizeCsvCellValue,
  shouldStripPathologicalCombiningMarks
} from '../src/download-csv.js'

test('buildCsvString preserves ordinary unicode text', () => {
  const csv = buildCsvString(
    ['name', 'note'],
    [['Jos\u00E9', 'e\u0301 and hello']]
  )

  assert.match(csv, /Jos\u00E9/)
  assert.match(csv, /e\u0301 and hello/)
})

test('shouldStripPathologicalCombiningMarks detects zalgo-like text', () => {
  const value = 'M\u0334\u0306\u0357\u031B\u0358\u035D\u0340\u030C\u0349\u0316\u0345y\u0338\u030D\u035D\u0314\u030C\u0304\u034C\u0302\u0350\u030B'

  assert.equal(shouldStripPathologicalCombiningMarks(value), true)
})

test('normalizeCsvCellValue strips pathological combining mark spam', () => {
  const value = 'M\u0334\u0306\u0357\u031B\u0358\u035D\u0340\u030C\u0349\u0316\u0345y\u0338\u030D\u035D\u0314\u030C\u0304\u034C\u0302\u0350\u030B'

  assert.equal(normalizeCsvCellValue(value), 'My')
})
