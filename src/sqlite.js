import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import initSqlJs from 'sql.js'

let instance

export default function initSQLite() {
  if (!instance) instance = initSqlJs({ locateFile: () => wasmUrl })
  return instance
}