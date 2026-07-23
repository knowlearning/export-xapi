import { loadXapiSqliteDataset } from '../sources/xapi-sqlite.js'

function defaultValueForParameter(parameter) {
  if (parameter.defaultValue !== undefined) return parameter.defaultValue
  if (parameter.type === 'number') return null
  return ''
}

function hasUserEnteredValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function normalizeParameterValue(parameter, value) {
  if (value === undefined || value === null || value === '') {
    if (parameter.required && parameter.defaultValue === undefined) {
      throw new Error(`${parameter.label} is required`)
    }
    return defaultValueForParameter(parameter)
  }

  if (parameter.type === 'number') {
    const parsedValue = Number(value)
    if (Number.isNaN(parsedValue)) {
      throw new Error(`${parameter.label} must be a number`)
    }
    return parsedValue
  }

  return value
}

function executeQuery(db, query, bindings = {}) {
  const statement = db.prepare(query)
  const hasBindings = bindings && Object.keys(bindings).length > 0
  if (hasBindings) statement.bind(bindings)

  const columns = statement.getColumnNames()
  const rows = []

  try {
    while (statement.step()) {
      rows.push(statement.getAsObject())
    }
  } finally {
    statement.free()
  }

  return { columns, rows }
}

function createScopedDatabase(SQLite, sourceDb, tableName, query, bindings) {
  const scopedDb = new SQLite.Database()
  const statement = sourceDb.prepare(query)
  statement.bind(bindings)

  const columns = statement.getColumnNames()

  scopedDb.run(`
    CREATE TABLE ${tableName} (
      id TEXT PRIMARY KEY,
      ${
        columns
          .filter(name => name !== 'id')
          .map(name => `${name} TEXT`)
          .join(',\n')
      }
    )
  `)

  const insert = scopedDb.prepare(`
    INSERT INTO ${tableName}
      (${columns.join(', ')})
    VALUES
      (${columns.map(() => '?').join(', ')})
  `)

  try {
    while (statement.step()) {
      insert.run(statement.get())
    }
  } finally {
    statement.free()
    insert.free()
  }

  return scopedDb
}

function deriveColumns({ columnKeys, displayNames = {} }) {
  return columnKeys.map(key => ({
    key,
    label: displayNames[key] ?? key
  }))
}

function normalizeColumns(columns = [], rows = []) {
  if (columns.length > 0) return columns

  const inferredKeys = Object.keys(rows[0] || {})
  return inferredKeys.map(key => ({ key, label: key }))
}

function normalizeRows(rows = [], columns = []) {
  return rows.map(row =>
    columns.reduce((accumulator, column) => {
      accumulator[column.key] = row?.[column.key] ?? ''
      return accumulator
    }, {})
  )
}

function normalizeResult(result = {}) {
  const columns = normalizeColumns(result.columns, result.rows)
  const rows = normalizeRows(result.rows || [], columns)

  return {
    columns,
    rows,
    rawData: result.rawData ?? null,
    meta: {
      rowCount: rows.length,
      ...(result.meta || {})
    }
  }
}

function transformSqlPlanResult(result, plan) {
  if (!plan.transformRows) return result

  const transformedRows = plan.transformRows(result.rows)
  if (!Array.isArray(transformedRows)) {
    throw new Error('SQL plan transformRows must return an array')
  }

  const rows = normalizeRows(transformedRows, result.columns)

  return {
    ...result,
    rows,
    meta: {
      ...result.meta,
      rowCount: rows.length
    }
  }
}

function executeDerivedColumnsPlan({
  SQLite,
  db,
  tableName,
  keyRows,
  plan
}) {
  const resultRows = []

  for (const keyRow of keyRows) {
    const scopedDb = createScopedDatabase(
      SQLite,
      db,
      tableName,
      plan.rowScopeQuery,
      Object.entries(keyRow).reduce((accumulator, [key, value]) => {
        accumulator[`$${key}`] = value
        return accumulator
      }, {})
    )

    const resultRow = { ...keyRow }

    for (const column of plan.derivedColumns) {
      const { rows } = executeQuery(scopedDb, column.query)
      let cellValue = rows[0]?.value ?? null

      if (column.transform && cellValue != null) {
        cellValue = column.transform(cellValue, keyRow)
      }

      resultRow[column.key] = cellValue ?? ''
    }

    resultRows.push(resultRow)
  }

  return resultRows
}

function executeSqlPlan({
  SQLite,
  dataset,
  plan
}) {
  const tableName = plan.tableName || dataset.tableName || 'statements'
  const { columns: keyColumns, rows: keyRows } = executeQuery(dataset.db, plan.rowKeyQuery)

  if (!plan.rowScopeQuery || !plan.derivedColumns?.length) {
    const result = normalizeResult({
      columns: deriveColumns({
        columnKeys: keyColumns,
        displayNames: plan.displayNames
      }),
      rows: keyRows,
      rawData: dataset.rawData
    })

    return transformSqlPlanResult(result, plan)
  }

  const derivedRows = executeDerivedColumnsPlan({
    SQLite,
    db: dataset.db,
    tableName,
    keyRows,
    plan
  })

  const result = normalizeResult({
    columns: [
      ...deriveColumns({
        columnKeys: keyColumns,
        displayNames: plan.displayNames
      }),
      ...plan.derivedColumns.map(column => ({
        key: column.key,
        label: column.label
      }))
    ],
    rows: derivedRows,
    rawData: dataset.rawData
  })

  return transformSqlPlanResult(result, plan)
}

export function getInitialParams(definition) {
  return (definition.parameterSchema || []).reduce((accumulator, parameter) => {
    accumulator[parameter.key] = defaultValueForParameter(parameter)
    return accumulator
  }, {})
}

export function mergeParamsForExportChange(definition, {
  currentParams = {},
  touchedParams = {},
  rememberedValues = {}
} = {}) {
  const nextParams = getInitialParams(definition)

  for (const parameter of definition?.parameterSchema || []) {
    const currentValue = currentParams[parameter.key]
    const rememberedValue = rememberedValues[parameter.key]

    if (touchedParams[parameter.key] && hasUserEnteredValue(currentValue)) {
      nextParams[parameter.key] = currentValue
      continue
    }

    if (hasUserEnteredValue(rememberedValue)) {
      nextParams[parameter.key] = rememberedValue
    }
  }

  return nextParams
}

export function normalizeParams(parameterSchema = [], rawParams = {}) {
  return parameterSchema.reduce((accumulator, parameter) => {
    accumulator[parameter.key] = normalizeParameterValue(parameter, rawParams[parameter.key])
    return accumulator
  }, {})
}

export async function executeExport(definition, {
  rawParams = {},
  environment,
  agent,
  SQLite
}) {
  const resolvedAgent = agent || globalThis.Agent
  const params = normalizeParams(definition.parameterSchema, rawParams)
  const domain = params.domain || definition.defaultDomain
  const result = await definition.run({
    params,
    domain,
    environment,
    agent: resolvedAgent,
    SQLite
  })

  if (result?.mode !== 'sql-plan') {
    return {
      definition,
      params,
      result: normalizeResult(result)
    }
  }

  if (definition.sourceType !== 'xapi-sqlite') {
    throw new Error(`Unsupported source type for SQL plan: ${definition.sourceType}`)
  }

  const contextParameterKey = definition.contextParameterKey || 'contextId'
  const context = params[contextParameterKey]
  const dataset = await (
    result.dataset ??
    loadXapiSqliteDataset({
      context,
      domain,
      agent: resolvedAgent,
      SQLite
    })
  )

  if (!dataset.db) {
    const keyColumns = result.rowKeyColumns || []
    const derivedColumns = result.derivedColumns || []

    return {
      definition,
      params,
      result: normalizeResult({
        columns: [
          ...deriveColumns({
            columnKeys: keyColumns,
            displayNames: result.displayNames
          }),
          ...derivedColumns.map(column => ({
            key: column.key,
            label: column.label
          }))
        ],
        rows: [],
        rawData: dataset.rawData
      })
    }
  }

  return {
    definition,
    params,
    result: executeSqlPlan({
      SQLite,
      dataset,
      plan: result
    })
  }
}
