import initSQLite from './sqlite.js'

export default async function (context) {
  const SQLite = await initSQLite()
  const data = await Agent.query('statements-in-context', [context], 'xapi.knowlearning.systems')
  if (data.length === 0) return

  const keys = Object.keys(data[0])

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
      VALUES (${keys.map(k => '?').join(', ')})
  `)
  for (const p of data) {
    insert.run(
      Object.values(p).map(v => {
        if (v === null || v === undefined) return null
        if (typeof v === 'object') return JSON.stringify(v)
        if (typeof v === 'boolean') return v ? '1' : '0'
        return String(v)
      })
    )
  }
  insert.free()
  return [db, keys]
}