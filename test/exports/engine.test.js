import test from 'node:test'
import assert from 'node:assert/strict'
import initSqlJs from 'sql.js'

import { executeExport, normalizeParams } from '../../src/exports/engine.js'
import { getExportDefinition } from '../../src/exports/registry.js'
import { loadXapiSqliteDataset } from '../../src/sources/xapi-sqlite.js'

let sqlitePromise

function getSQLite() {
  if (!sqlitePromise) sqlitePromise = initSqlJs()
  return sqlitePromise
}

test('normalizeParams applies defaults and validates numbers', () => {
  const schema = [
    {
      key: 'contextId',
      label: 'Context ID',
      type: 'text',
      required: true,
      defaultValue: 'ctx-default'
    },
    {
      key: 'limit',
      label: 'Limit',
      type: 'number',
      required: true,
      defaultValue: 25
    }
  ]

  assert.deepEqual(normalizeParams(schema, {}), {
    contextId: 'ctx-default',
    limit: 25
  })

  assert.throws(
    () => normalizeParams([{ key: 'limit', label: 'Limit', type: 'number', required: true }], { limit: 'abc' }),
    /must be a number/
  )
})

test('executeExport normalizes direct-row exports', async () => {
  const definition = {
    id: 'direct-test',
    sourceType: 'direct',
    parameterSchema: [
      {
        key: 'contextId',
        label: 'Context ID',
        type: 'text',
        required: true,
        defaultValue: 'ctx-default'
      }
    ],
    async run({ params }) {
      return {
        rows: [
          {
            context_id: params.contextId,
            total_rows: 1
          }
        ]
      }
    }
  }

  const execution = await executeExport(definition, {
    rawParams: {},
    environment: {}
  })

  assert.deepEqual(execution.params, { contextId: 'ctx-default' })
  assert.deepEqual(execution.result.columns, [
    { key: 'context_id', label: 'context_id' },
    { key: 'total_rows', label: 'total_rows' }
  ])
  assert.deepEqual(execution.result.rows, [
    {
      context_id: 'ctx-default',
      total_rows: 1
    }
  ])
  assert.equal(execution.result.meta.rowCount, 1)
})

test('student-teacher-class-ids export is registered and requires domain', () => {
  const definition = getExportDefinition('student-teacher-class-ids')

  assert.ok(definition)
  assert.equal(definition.sourceType, 'direct')
  assert.throws(
    () => normalizeParams(definition.parameterSchema, {}),
    /Domain is required/
  )
})

test('student-teacher-class-ids export passes query name, args, and domain through to Agent.query', async () => {
  const definition = getExportDefinition('student-teacher-class-ids')
  const calls = []

  const execution = await executeExport(definition, {
    rawParams: {
      domain: 'district.example.test'
    },
    environment: {},
    agent: {
      async query(name, args, domain) {
        calls.push({ name, args, domain })

        return [
          {
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            class_id: 'class-1'
          }
        ]
      }
    }
  })

  assert.deepEqual(calls, [
    {
      name: 'student-teacher-class-ids',
      args: [],
      domain: 'district.example.test'
    }
  ])
  assert.deepEqual(execution.result.columns, [
    { key: 'student_id', label: 'student_id' },
    { key: 'teacher_id', label: 'teacher_id' },
    { key: 'class_id', label: 'class_id' }
  ])
  assert.deepEqual(execution.result.rows, [
    {
      student_id: 'student-1',
      teacher_id: 'teacher-1',
      class_id: 'class-1'
    }
  ])
  assert.equal(execution.result.meta.rowCount, 1)
})

test('student-teacher-class-ids export handles empty query results', async () => {
  const definition = getExportDefinition('student-teacher-class-ids')

  const execution = await executeExport(definition, {
    rawParams: {
      domain: 'district.example.test'
    },
    environment: {},
    agent: {
      async query() {
        return []
      }
    }
  })

  assert.deepEqual(execution.result.columns, [])
  assert.deepEqual(execution.result.rows, [])
  assert.equal(execution.result.meta.rowCount, 0)
})

test('loadXapiSqliteDataset serializes objects and booleans into SQLite', async () => {
  const SQLite = await getSQLite()

  const dataset = await loadXapiSqliteDataset({
    context: 'ctx-1',
    domain: 'xapi.example.test',
    SQLite,
    agent: {
      async query(name, args, domain) {
        assert.equal(name, 'statements-in-context')
        assert.deepEqual(args, ['ctx-1'])
        assert.equal(domain, 'xapi.example.test')

        return [
          {
            id: 'statement-1',
            authority: 'user-1',
            extensions: { foo: 'bar' },
            success: true,
            stored: '2026-01-01T00:00:00.000Z'
          }
        ]
      }
    }
  })

  assert.deepEqual(dataset.rawData.columns, ['id', 'authority', 'extensions', 'success', 'stored'])

  const statement = dataset.db.prepare('SELECT authority, extensions, success FROM statements')
  statement.step()

  assert.deepEqual(statement.getAsObject(), {
    authority: 'user-1',
    extensions: JSON.stringify({ foo: 'bar' }),
    success: '1'
  })

  statement.free()
})

test('executeExport runs xAPI SQL plan exports with derived columns and raw data', async () => {
  const SQLite = await getSQLite()

  const definition = {
    id: 'sql-test',
    sourceType: 'xapi-sqlite',
    contextParameterKey: 'contextId',
    defaultDomain: 'xapi.example.test',
    supportsRawDownload: true,
    parameterSchema: [
      {
        key: 'contextId',
        label: 'Context ID',
        type: 'text',
        required: true
      }
    ],
    async run() {
      return {
        mode: 'sql-plan',
        displayNames: {
          student_id: 'Student ID'
        },
        rowKeyColumns: ['student_id'],
        rowKeyQuery: `
          SELECT DISTINCT authority AS student_id
          FROM statements
          ORDER BY authority
        `,
        rowScopeQuery: `
          SELECT *
          FROM statements
          WHERE authority = $student_id
        `,
        derivedColumns: [
          {
            key: 'attempts',
            label: 'Attempts',
            query: `SELECT COUNT(*) AS value FROM statements`
          }
        ]
      }
    }
  }

  const execution = await executeExport(definition, {
    rawParams: { contextId: 'ctx-1' },
    environment: {},
    SQLite,
    agent: {
      async query() {
        return [
          { id: 'statement-1', authority: 'student-a', verb: 'submitted' },
          { id: 'statement-2', authority: 'student-a', verb: 'submitted' },
          { id: 'statement-3', authority: 'student-b', verb: 'submitted' }
        ]
      }
    }
  })

  assert.deepEqual(execution.result.columns, [
    { key: 'student_id', label: 'Student ID' },
    { key: 'attempts', label: 'Attempts' }
  ])
  assert.deepEqual(execution.result.rows, [
    { student_id: 'student-a', attempts: 2 },
    { student_id: 'student-b', attempts: 1 }
  ])
  assert.equal(execution.result.meta.rowCount, 2)
  assert.deepEqual(execution.result.rawData.columns, ['id', 'authority', 'verb'])
})
