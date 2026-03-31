import test from 'node:test'
import assert from 'node:assert/strict'

import {
  loadRememberedState,
  rememberParameterValue,
  rememberSelectedExport,
  removeRememberedTextValue,
  saveRememberedState
} from '../src/parameter-memory.js'

function createStorage(initialValue = null) {
  let value = initialValue

  return {
    getItem(key) {
      assert.equal(key, 'export-tool-remembered-params:v1')
      return value
    },
    setItem(key, nextValue) {
      assert.equal(key, 'export-tool-remembered-params:v1')
      value = nextValue
    }
  }
}

test('rememberParameterValue stores text history and last values', () => {
  const parameter = {
    key: 'contextId',
    type: 'text'
  }

  let state = rememberParameterValue(undefined, parameter, 'ctx-1')
  state = rememberParameterValue(state, parameter, 'ctx-2')
  state = rememberParameterValue(state, parameter, 'ctx-1')

  assert.deepEqual(state.lastValues, {
    contextId: 'ctx-1'
  })
  assert.deepEqual(state.textHistory, {
    contextId: ['ctx-1', 'ctx-2']
  })
})

test('rememberParameterValue stores last value for non-text parameters without adding history', () => {
  const state = rememberParameterValue(undefined, {
    key: 'format',
    type: 'select'
  }, 'csv')

  assert.deepEqual(state.lastValues, {
    format: 'csv'
  })
  assert.deepEqual(state.textHistory, {})
})

test('removeRememberedTextValue removes history entries and matching last value', () => {
  const initialState = {
    selectedExportId: 'survey-responses',
    lastValues: {
      contextId: 'ctx-2',
      domain: 'district.example.test'
    },
    textHistory: {
      contextId: ['ctx-1', 'ctx-2']
    }
  }

  const nextState = removeRememberedTextValue(initialState, 'contextId', 'ctx-2')

  assert.deepEqual(nextState.lastValues, {
    domain: 'district.example.test'
  })
  assert.deepEqual(nextState.textHistory, {
    contextId: ['ctx-1']
  })
})

test('saveRememberedState and loadRememberedState round-trip through storage', () => {
  const storage = createStorage()
  const state = rememberParameterValue(
    rememberSelectedExport(undefined, 'rct-chatbot'),
    { key: 'domain', type: 'text' },
    'district.example.test'
  )

  saveRememberedState(state, storage)

  assert.deepEqual(loadRememberedState(storage), {
    selectedExportId: 'rct-chatbot',
    lastValues: {
      domain: 'district.example.test'
    },
    textHistory: {
      domain: ['district.example.test']
    }
  })
})

test('loadRememberedState falls back to empty state for invalid storage data', () => {
  const storage = createStorage('{not-json')

  assert.deepEqual(loadRememberedState(storage), {
    selectedExportId: '',
    lastValues: {},
    textHistory: {}
  })
})
