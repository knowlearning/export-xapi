import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import initSqlJs from 'sql.js'

export default function initSQLite() { return initSqlJs({ locateFile: () => wasmUrl }) }