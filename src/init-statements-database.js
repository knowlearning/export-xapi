import initSQLite from './sqlite.js'
import { loadXapiSqliteDataset } from './sources/xapi-sqlite.js'

export default async function (context, options = {}) {
  const SQLite = await initSQLite()
  const dataset = await loadXapiSqliteDataset({
    context,
    domain: options.domain || 'xapi.knowlearning.systems',
    agent: options.agent || Agent,
    SQLite
  })

  return dataset.db
}
