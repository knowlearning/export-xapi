const STORAGE_KEY = 'export-tool-remembered-params:v1'
const MAX_TEXT_HISTORY_ITEMS = 10

function createEmptyRememberedState() {
  return {
    selectedExportId: '',
    lastValues: {},
    textHistory: {}
  }
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function hasRememberedValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function normalizeTextHistory(history) {
  if (!isObject(history)) return {}

  return Object.entries(history).reduce((accumulator, [key, values]) => {
    if (!Array.isArray(values)) return accumulator

    const uniqueValues = values.filter((value, index) =>
      typeof value === 'string'
      && value !== ''
      && values.indexOf(value) === index
    )

    if (uniqueValues.length > 0) {
      accumulator[key] = uniqueValues.slice(0, MAX_TEXT_HISTORY_ITEMS)
    }

    return accumulator
  }, {})
}

function normalizeRememberedState(state) {
  const normalizedState = createEmptyRememberedState()

  if (!isObject(state)) return normalizedState

  normalizedState.selectedExportId = typeof state.selectedExportId === 'string'
    ? state.selectedExportId
    : ''
  normalizedState.lastValues = isObject(state.lastValues)
    ? { ...state.lastValues }
    : {}
  normalizedState.textHistory = normalizeTextHistory(state.textHistory)

  return normalizedState
}

export function loadRememberedState(storage = globalThis.localStorage) {
  if (!storage) return createEmptyRememberedState()

  try {
    const rawValue = storage.getItem(STORAGE_KEY)
    if (!rawValue) return createEmptyRememberedState()

    return normalizeRememberedState(JSON.parse(rawValue))
  } catch {
    return createEmptyRememberedState()
  }
}

export function saveRememberedState(state, storage = globalThis.localStorage) {
  const normalizedState = normalizeRememberedState(state)
  if (!storage) return normalizedState

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizedState))
  } catch {
    // Ignore storage quota and unavailable-storage failures.
  }

  return normalizedState
}

export function rememberSelectedExport(state, exportId) {
  return normalizeRememberedState({
    ...normalizeRememberedState(state),
    selectedExportId: exportId || ''
  })
}

export function rememberParameterValue(state, parameter, value) {
  const nextState = normalizeRememberedState(state)
  const parameterKey = parameter?.key

  if (!parameterKey) return nextState

  if (hasRememberedValue(value)) {
    nextState.lastValues[parameterKey] = value
  } else {
    delete nextState.lastValues[parameterKey]
  }

  if (parameter?.type !== 'text' || !hasRememberedValue(value)) {
    return nextState
  }

  const historyValue = String(value)
  const existingValues = nextState.textHistory[parameterKey] || []

  nextState.textHistory[parameterKey] = [
    historyValue,
    ...existingValues.filter(entry => entry !== historyValue)
  ].slice(0, MAX_TEXT_HISTORY_ITEMS)

  return nextState
}

export function removeRememberedTextValue(state, key, value) {
  const nextState = normalizeRememberedState(state)
  const historyValue = String(value ?? '')

  if (!key || historyValue === '') return nextState

  const nextHistory = (nextState.textHistory[key] || []).filter(entry => entry !== historyValue)

  if (nextHistory.length > 0) {
    nextState.textHistory[key] = nextHistory
  } else {
    delete nextState.textHistory[key]
  }

  if (nextState.lastValues[key] === value) {
    delete nextState.lastValues[key]
  }

  return nextState
}
