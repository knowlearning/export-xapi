export function toSqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

export function toSqlLiteral(value) {
  if (value == null) return 'NULL'
  return `'${toSqlString(value)}'`
}

export function toSqlList(values) {
  return values.map(value => toSqlLiteral(value)).join(', ')
}
