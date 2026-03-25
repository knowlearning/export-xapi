function serializeValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

export function createRawData(rows = []) {
  const columns = Object.keys(rows[0] || {})

  return {
    kind: 'xapi-statements',
    columns,
    rows: rows.map(row =>
      columns.map(column => serializeValue(row[column]) ?? '')
    )
  }
}

export async function loadXapiSqliteDataset({
  context,
  domain,
  agent,
  SQLite
}) {
  const resolvedAgent = agent || globalThis.Agent

  if (!context) {
    throw new Error('Context ID is required to load xAPI statements')
  }

  if (!resolvedAgent) {
    throw new Error('Agent is not available')
  }

  const rawRows = await resolvedAgent.query('statements-in-context', [context], domain)
  if (rawRows.length === 0) {
    return {
      db: null,
      rawRows,
      rawData: createRawData(rawRows),
      tableName: 'statements'
    }
  }

  const keys = Object.keys(rawRows[0])
  const db = new SQLite.Database()

  db.run(`
    CREATE TABLE statements (
      id TEXT PRIMARY KEY,
      ${
        keys
          .filter(name => name !== 'id')
          .map(name => `${name} TEXT`)
          .join(',\n')
      }
    );
  `)

  const insert = db.prepare(`
    INSERT
      INTO statements (${keys.join(', ')})
      VALUES (${keys.map(() => '?').join(', ')})
  `)

  for (const row of rawRows) {
    insert.run(keys.map(key => serializeValue(row[key])))
  }

  insert.free()

  return {
    db,
    rawRows,
    rawData: createRawData(rawRows),
    tableName: 'statements'
  }
}
