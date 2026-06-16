import test from 'node:test'
import assert from 'node:assert/strict'
import initSqlJs from 'sql.js'

import {
  executeExport,
  mergeParamsForExportChange,
  normalizeParams
} from '../../src/exports/engine.js'
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

test('mergeParamsForExportChange preserves touched shared params and drops non-shared params', () => {
  const nextDefinition = {
    parameterSchema: [
      {
        key: 'contextId',
        label: 'Context ID',
        type: 'text',
        required: true,
        defaultValue: 'ctx-default'
      },
      {
        key: 'cohort',
        label: 'Cohort',
        type: 'text',
        defaultValue: 'pilot'
      }
    ]
  }

  assert.deepEqual(
    mergeParamsForExportChange(nextDefinition, {
      currentParams: {
        contextId: 'ctx-user-entered',
        domain: 'district.example.test'
      },
      touchedParams: {
        contextId: true,
        domain: true
      }
    }),
    {
      contextId: 'ctx-user-entered',
      cohort: 'pilot'
    }
  )
})

test('mergeParamsForExportChange keeps new defaults when shared params were not user-entered', () => {
  const nextDefinition = {
    parameterSchema: [
      {
        key: 'contextId',
        label: 'Context ID',
        type: 'text',
        required: true,
        defaultValue: 'ctx-default'
      }
    ]
  }

  assert.deepEqual(
    mergeParamsForExportChange(nextDefinition, {
      currentParams: {
        contextId: ''
      },
      touchedParams: {
        contextId: true
      }
    }),
    {
      contextId: 'ctx-default'
    }
  )
})

test('mergeParamsForExportChange applies remembered values when current params were not touched', () => {
  const nextDefinition = {
    parameterSchema: [
      {
        key: 'contextId',
        label: 'Context ID',
        type: 'text',
        required: true,
        defaultValue: 'ctx-default'
      },
      {
        key: 'domain',
        label: 'Domain',
        type: 'text',
        required: true
      }
    ]
  }

  assert.deepEqual(
    mergeParamsForExportChange(nextDefinition, {
      currentParams: {},
      touchedParams: {},
      rememberedValues: {
        contextId: 'ctx-remembered',
        domain: 'district.example.test'
      }
    }),
    {
      contextId: 'ctx-remembered',
      domain: 'district.example.test'
    }
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

test('loadXapiSqliteDataset exposes result.response as a SQL response column for sparse rows', async () => {
  const SQLite = await getSQLite()

  const dataset = await loadXapiSqliteDataset({
    context: 'ctx-1',
    domain: 'xapi.example.test',
    SQLite,
    agent: {
      async query() {
        return [
          {
            id: 'statement-1',
            authority: 'user-1',
            verb: 'initialized',
            stored: '2026-01-01T00:00:00.000Z'
          },
          {
            id: 'statement-2',
            authority: 'user-1',
            verb: 'answered',
            stored: '2026-01-01T00:01:00.000Z',
            result: { response: 42 }
          }
        ]
      }
    }
  })

  assert.deepEqual(dataset.rawData.columns, ['id', 'authority', 'verb', 'stored'])

  const statement = dataset.db.prepare("SELECT response FROM statements WHERE verb = 'answered'")
  statement.step()

  assert.deepEqual(statement.getAsObject(), { response: '42' })

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

test('survey responses export preserves legacy jsonform output format', async () => {
  const SQLite = await getSQLite()
  const definition = getExportDefinition('survey-responses')
  const sequenceId = 'sequence-1'
  const assignmentId = 'assignment-1'
  const surveyPageId = 'survey-page-1'

  const execution = await executeExport(definition, {
    rawParams: { contextId: sequenceId },
    environment: {},
    SQLite,
    agent: {
      async state(id) {
        if (id === sequenceId) {
          return { items: [{ id: surveyPageId }] }
        }

        if (id === surveyPageId) {
          return {
            formData: [
              { type: 'text', name: 'q1' },
              { type: 'radio-group', name: 'q2' }
            ]
          }
        }

        throw new Error(`Unexpected state lookup: ${id}`)
      },
      async query() {
        return [
          {
            id: 'statement-1',
            authority: 'student-1',
            object: surveyPageId,
            verb: 'initialized',
            stored: '2026-01-01T00:00:00.000Z',
            embed_path: [assignmentId, sequenceId, surveyPageId],
            extensions: {}
          },
          {
            id: 'statement-2',
            authority: 'student-1',
            object: 'dashboard',
            verb: 'initialized',
            stored: '2026-01-01T00:00:30.000Z',
            embed_path: [assignmentId, sequenceId, surveyPageId],
            extensions: {}
          },
          {
            id: 'statement-3',
            authority: 'student-1',
            object: 'q1',
            verb: 'answered',
            stored: '2026-01-01T00:01:00.000Z',
            embed_path: [assignmentId, sequenceId, surveyPageId],
            response: 'old',
            extensions: { item: { name: 'q1' } }
          },
          {
            id: 'statement-4',
            authority: 'student-1',
            object: 'q1',
            verb: 'answered',
            stored: '2026-01-01T00:02:00.000Z',
            embed_path: [assignmentId, sequenceId, surveyPageId],
            response: 'new',
            extensions: { item: { name: 'q1' } }
          },
          {
            id: 'statement-5',
            authority: 'student-1',
            object: 'q2',
            verb: 'answered',
            stored: '2026-01-01T00:03:00.000Z',
            embed_path: [assignmentId, sequenceId, surveyPageId],
            response: 'yes',
            extensions: { item: { name: 'q2' } }
          },
          {
            id: 'statement-6',
            authority: 'student-1',
            object: surveyPageId,
            verb: 'completed',
            stored: '2026-01-01T00:04:00.000Z',
            embed_path: [assignmentId, sequenceId, surveyPageId],
            extensions: {}
          }
        ]
      }
    }
  })

  assert.deepEqual(execution.result.columns, [
    { key: 'user', label: 'user ID' },
    { key: 'assignment', label: 'assignment ID' },
    { key: 'q1', label: 'q1' },
    { key: 'q2', label: 'q2' },
    { key: 'started', label: 'started' },
    { key: 'submission timestamp', label: 'submission timestamp' },
    { key: 'total time spent (seconds)', label: 'total time spent (seconds)' }
  ])
  assert.deepEqual(execution.result.rows, [
    {
      user: 'student-1',
      assignment: assignmentId,
      q1: 'new',
      q2: 'yes',
      started: '2026-01-01T00:00:00.000Z',
      'submission timestamp': '2026-01-01T00:00:30.000Z',
      'total time spent (seconds)': 239
    }
  ])
})

test('survey responses export supports direct SurveyJS survey contexts', async () => {
  const SQLite = await getSQLite()
  const definition = getExportDefinition('survey-responses')
  const surveyId = 'survey-1'

  const execution = await executeExport(definition, {
    rawParams: { contextId: surveyId },
    environment: {},
    SQLite,
    agent: {
      async state(id) {
        if (id === surveyId) {
          return {
            id: surveyId,
            schema: {
              pages: [
                {
                  elements: [
                    { type: 'text', name: 'q1' },
                    {
                      type: 'panel',
                      name: 'panel-1',
                      elements: [{ type: 'radiogroup', name: 'q2' }]
                    }
                  ]
                }
              ]
            }
          }
        }

        throw new Error(`Unexpected state lookup: ${id}`)
      },
      async query() {
        return [
          {
            id: 'statement-1',
            authority: 'student-1',
            object: surveyId,
            verb: 'initialized',
            stored: '2026-01-01T00:00:00.000Z',
            extensions: {}
          },
          {
            id: 'statement-2',
            authority: 'student-1',
            object: 'q1',
            verb: 'answered',
            stored: '2026-01-01T00:01:00.000Z',
            result: { response: 42 },
            extensions: { item: { name: 'q1' } }
          },
          {
            id: 'statement-3',
            authority: 'student-1',
            object: 'q2',
            verb: 'answered',
            stored: '2026-01-01T00:01:30.000Z',
            result: { response: 'yes' },
            extensions: { item: { name: 'q2' } }
          },
          {
            id: 'statement-4',
            authority: 'student-1',
            object: surveyId,
            verb: 'completed',
            stored: '2026-01-01T00:02:00.000Z',
            extensions: {}
          }
        ]
      }
    }
  })

  assert.deepEqual(execution.result.columns, [
    { key: 'user', label: 'user ID' },
    { key: 'assignment', label: 'assignment ID' },
    { key: 'q1', label: 'q1' },
    { key: 'q2', label: 'q2' },
    { key: 'started', label: 'started' },
    { key: 'submission timestamp', label: 'submission timestamp' },
    { key: 'total time spent (seconds)', label: 'total time spent (seconds)' }
  ])
  assert.deepEqual(execution.result.rows, [
    {
      user: 'student-1',
      assignment: surveyId,
      q1: '42',
      q2: 'yes',
      started: '2026-01-01T00:00:00.000Z',
      'submission timestamp': '2026-01-01T00:02:00.000Z',
      'total time spent (seconds)': 119
    }
  ])
})

test('student sequence data export repeats sequence timeout flags onto matching item rows', async () => {
  const SQLite = await getSQLite()
  const definition = getExportDefinition('rct-student-sequence-data')
  const sequenceId = 'sequence-1'
  const assignmentId = 'assignment-1'
  const problemId = 'problem-1'

  const execution = await executeExport(definition, {
    rawParams: { contextId: sequenceId },
    environment: {},
    SQLite,
    agent: {
      async state(id) {
        if (id === sequenceId) {
          return {
            name: 'Sequence One',
            description: 'Concept A',
            problemIds: [problemId]
          }
        }

        if (id === problemId) {
          return {
            id: problemId,
            kind: 'multiple_choice',
            options: [
              { id: 'choice-a', kind: 'text', value: 'A', isCorrect: true },
              { id: 'choice-b', kind: 'text', value: 'B', isCorrect: false }
            ]
          }
        }

        throw new Error(`Unexpected state lookup: ${id}`)
      },
      async query(name, args) {
        assert.equal(name, 'statements-in-context')
        assert.deepEqual(args, [sequenceId])

        return [
          {
            id: 'statement-1',
            authority: 'student-1',
            object: problemId,
            verb: 'initialized',
            stored: '2026-01-01T00:00:00.000Z',
            embed_path: [assignmentId, sequenceId],
            extensions: { sequenceEvent: { sequenceOrder: 3 } }
          },
          {
            id: 'statement-2',
            authority: 'student-1',
            object: problemId,
            verb: 'submitted',
            stored: '2026-01-01T00:01:00.000Z',
            embed_path: [assignmentId, sequenceId],
            extensions: {
              runState: { selectedOptionId: 'choice-a', isCorrect: true },
              sequenceEvent: { misconception: 'none', sequenceOrder: 3 }
            }
          },
          {
            id: 'statement-3',
            authority: 'student-1',
            object: sequenceId,
            verb: 'attempt_timeout',
            stored: '2026-01-01T00:02:00.000Z',
            embed_path: [assignmentId, sequenceId],
            extensions: {}
          },
          {
            id: 'statement-4',
            authority: 'student-1',
            object: sequenceId,
            verb: 'review_timeout',
            stored: '2026-01-01T00:03:00.000Z',
            embed_path: [assignmentId, sequenceId],
            extensions: {}
          },
          {
            id: 'statement-5',
            authority: 'student-2',
            object: 'problem-2',
            verb: 'initialized',
            stored: '2026-01-01T00:04:00.000Z',
            embed_path: ['assignment-2', sequenceId],
            extensions: { sequenceEvent: { sequenceOrder: 1 } }
          }
        ]
      }
    }
  })

  assert.ok(execution.result.columns.some(column => column.key === 'attempt_timeout'))
  assert.ok(execution.result.columns.some(column => column.key === 'review_timeout'))
  assert.deepEqual(execution.result.rows, [
    {
      student_id: 'student-1',
      sequence_id: sequenceId,
      assignment_id: assignmentId,
      item_id: problemId,
      'Sequence Order': 3,
      'Sequence Name': 'Sequence One',
      'Sequence Concepts': 'Concept A',
      'Item Position': 0,
      'Item Type': 'multiple_choice',
      'Item Difficulty': '',
      'Date': '2026-01-01',
      'Time stamp': '2026-01-01T00:00:00.000Z',
      Misconceptions: 'none',
      'Answer 1': 'A',
      'Answer 2': '',
      'Answer 3': '',
      'Final answer': 'A',
      'Correct answer': 'A',
      Attempts: 1,
      'Item skipped': 0,
      'Item reached': 1,
      Correct: 1,
      'Hands raised': 0,
      'Time spent on item (exercise) in seconds': 59,
      'Time spent on item (review) in seconds': '',
      attempt_timeout: 1,
      review_timeout: 1,
      '# of messages sent (student)': 0,
      '# of messages sent (chatbot)': 0,
      'Student initiated chat': 0,
      'timestamp of first interaction with chatbot': ''
    }
  ])
})

test('student sequence data export emits zero timeout flags when no matching sequence timeouts exist', async () => {
  const SQLite = await getSQLite()
  const definition = getExportDefinition('rct-student-sequence-data')
  const sequenceId = 'sequence-1'
  const assignmentId = 'assignment-1'
  const problemId = 'problem-1'

  const execution = await executeExport(definition, {
    rawParams: { contextId: sequenceId },
    environment: {},
    SQLite,
    agent: {
      async state(id) {
        if (id === sequenceId) {
          return {
            name: 'Sequence One',
            description: 'Concept A',
            problemIds: [problemId]
          }
        }

        if (id === problemId) {
          return {
            id: problemId,
            kind: 'multiple_choice',
            options: [
              { id: 'choice-a', kind: 'text', value: 'A', isCorrect: true }
            ]
          }
        }

        throw new Error(`Unexpected state lookup: ${id}`)
      },
      async query() {
        return [
          {
            id: 'statement-1',
            authority: 'student-1',
            object: problemId,
            verb: 'initialized',
            stored: '2026-01-01T00:00:00.000Z',
            embed_path: [assignmentId, sequenceId],
            extensions: { sequenceEvent: { sequenceOrder: 3 } }
          }
        ]
      }
    }
  })

  assert.equal(execution.result.rows[0].attempt_timeout, 0)
  assert.equal(execution.result.rows[0].review_timeout, 0)
})
