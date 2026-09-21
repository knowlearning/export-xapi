import test from 'node:test'
import assert from 'node:assert/strict'
import initSqlJs from 'sql.js'

import { executeExport } from '../../src/exports/engine.js'
import { getExportDefinition } from '../../src/exports/registry.js'
import chatbotExport from '../../src/exports/rct-chatbot.js'

let sqlitePromise

async function runSqlExport(definition, states, statements) {
  if (!sqlitePromise) sqlitePromise = initSqlJs()

  return executeExport(definition, {
    rawParams: { contextId: 'context-1' },
    environment: {},
    SQLite: await sqlitePromise,
    agent: {
      async state(id) {
        assert.ok(Object.hasOwn(states, id), `Unexpected state lookup: ${id}`)
        return states[id]
      },
      async query(name, args, domain) {
        assert.equal(name, 'statements-in-context')
        assert.deepEqual(args, ['context-1'])
        assert.equal(domain, 'xapi.knowlearning.systems')
        return statements
      }
    }
  })
}

const sourceDomains = ['first.example.test', 'second.example.test', null]

for (const mode of ['direct', 'sequence']) {
  test(`survey responses keep ${mode} responses and timing separate by originating domain`, async () => {
    const survey = { schema: { elements: [{ type: 'text', name: 'answer' }] } }
    const states = mode === 'direct'
      ? { 'context-1': survey }
      : { 'context-1': { items: [{ id: 'survey-1' }] }, 'survey-1': survey }
    const statements = sourceDomains.flatMap((domain, index) => {
      const statement = {
        authority: 'student-1',
        object: 'survey-1',
        domain,
        stored: '2026-01-01T00:00:00.000Z',
        embed_path: mode === 'sequence'
          ? ['assignment-1', 'context-1', 'survey-1']
          : ['assignment-1']
      }

      return [
        {
          ...statement,
          id: `answer-${index}`,
          verb: 'answered',
          response: `response-${index}`,
          extensions: { item: { name: 'answer' } }
        },
        {
          ...statement,
          id: `heartbeat-${index}`,
          verb: 'heartbeat',
          extensions: { interval: (index + 1) * 10 }
        }
      ]
    })
    const { result } = await runSqlExport(getExportDefinition('survey-responses'), states, statements)

    assert.deepEqual(result.columns.slice(0, 3), [
      { key: 'user', label: 'user ID' },
      { key: 'assignment', label: 'assignment ID' },
      { key: 'domain', label: 'Domain' }
    ])
    assert.equal(result.rows.length, sourceDomains.length)

    sourceDomains.forEach((domain, index) => {
      const row = result.rows.find(row => row.domain === (domain ?? ''))
      assert.ok(row)
      assert.equal(row.user, 'student-1')
      assert.equal(row.assignment, 'assignment-1')
      assert.equal(row.answer, `response-${index}`)
      assert.equal(row['total time spent (seconds)'], (index + 1) * 10)
    })
  })
}

test('survey questions named domain retain responses without overwriting the originating domain', async () => {
  const questions = ['domain', 'domain_response']
  const statements = questions.map((name, index) => ({
    id: `answer-${index}`,
    authority: 'student-1',
    object: 'context-1',
    domain: 'first.example.test',
    verb: 'answered',
    stored: '2026-01-01T00:00:00.000Z',
    response: `response-${name}`,
    extensions: { item: { name } }
  }))
  const { result } = await runSqlExport(getExportDefinition('survey-responses'), {
    'context-1': {
      schema: { elements: questions.map(name => ({ type: 'text', name })) }
    }
  }, statements)

  assert.deepEqual(result.columns.slice(2, 5), [
    { key: 'domain', label: 'Domain' },
    { key: 'domain_response_response', label: 'domain' },
    { key: 'domain_response', label: 'domain_response' }
  ])
  const columnKeys = result.columns.map(column => column.key)
  assert.equal(new Set(columnKeys).size, columnKeys.length)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].domain, 'first.example.test')
  assert.equal(result.rows[0].domain_response_response, 'response-domain')
  assert.equal(result.rows[0].domain_response, 'response-domain_response')
})

test('student sequence data keeps attempts and sequence timeouts separate by originating domain', async () => {
  const states = {
    'context-1': { name: 'Sequence', problemIds: ['item-1'] },
    'item-1': {
      kind: 'multiple_choice',
      options: sourceDomains.map((domain, index) => ({
        id: `choice-${index}`,
        kind: 'text',
        value: `answer-${index}`,
        isCorrect: index === 0
      }))
    }
  }
  const statements = sourceDomains.flatMap((domain, index) => {
    const statement = {
      authority: 'student-1',
      object: 'item-1',
      domain,
      embed_path: ['assignment-1', 'context-1']
    }

    return [
      {
        ...statement,
        id: `initialized-${index}`,
        verb: 'initialized',
        stored: '2026-01-01T00:00:00.000Z',
        extensions: {}
      },
      ...Array.from({ length: index + 1 }, (unusedValue, attempt) => ({
        ...statement,
        id: `submitted-${index}-${attempt}`,
        verb: 'submitted',
        stored: `2026-01-01T00:0${attempt + 1}:00.000Z`,
        extensions: { runState: { selectedOptionId: `choice-${index}`, isCorrect: index === 0 } }
      }))
    ]
  })
  statements.push({
    id: 'timeout',
    authority: 'student-1',
    object: 'context-1',
    domain: sourceDomains[0],
    embed_path: ['assignment-1', 'context-1'],
    verb: 'attempt_timeout',
    stored: '2026-01-01T00:04:00.000Z',
    extensions: {}
  })

  const { result } = await runSqlExport(getExportDefinition('rct-student-sequence-data'), states, statements)

  assert.deepEqual(result.columns[4], { key: 'domain', label: 'Domain' })
  assert.equal(result.rows.length, sourceDomains.length)

  sourceDomains.forEach((domain, index) => {
    const row = result.rows.find(row => row.domain === (domain ?? ''))
    assert.ok(row)
    assert.equal(row.student_id, 'student-1')
    assert.equal(row.assignment_id, 'assignment-1')
    assert.equal(row.item_id, 'item-1')
    assert.equal(row.Attempts, index + 1)
    assert.equal(row['Final answer'], `answer-${index}`)
    assert.equal(row.attempt_timeout, index === 0 ? 1 : 0)
  })
})

test('chatbot interaction order restarts for each originating domain', async () => {
  const domains = [sourceDomains[0], sourceDomains[1], sourceDomains[0], null, null]
  const statements = domains.map((domain, index) => ({
    id: `chat-${index}`,
    authority: 'student-1',
    object: 'item-1',
    domain,
    embed_path: ['assignment-1', 'context-1'],
    stored: `2026-01-01T00:0${index}:00.000Z`,
    extensions: { chatbotEvent: { userPrompt: { text: `prompt-${index}` } } }
  }))
  const { result } = await runSqlExport(chatbotExport, {
    'context-1': { problemIds: ['item-1'] },
    'item-1': {}
  }, statements)

  assert.deepEqual(result.columns.at(-1), { key: 'domain', label: 'Domain' })
  assert.deepEqual(result.rows.map(row => ({
    domain: row.domain,
    order: row['Order of Interaction']
  })), [
    { domain: sourceDomains[0], order: 0 },
    { domain: sourceDomains[1], order: 0 },
    { domain: sourceDomains[0], order: 1 },
    { domain: '', order: 0 },
    { domain: '', order: 1 }
  ])
})

for (const definition of [
  getExportDefinition('survey-responses'),
  getExportDefinition('rct-student-sequence-data'),
  chatbotExport
]) {
  test(`${definition.id} retains its Domain column without statements`, async () => {
    const { result } = await runSqlExport(definition, { 'context-1': {} }, [])

    assert.deepEqual(result.columns.filter(column => column.key === 'domain'), [
      { key: 'domain', label: 'Domain' }
    ])
    assert.deepEqual(result.rows, [])
  })
}

test('context summary remains independent of domain', async () => {
  const { result } = await executeExport(getExportDefinition('context-summary'), {
    rawParams: { contextId: 'context-1' },
    environment: {},
    agent: {
      async state() {
        return { name: 'Study', domain: 'first.example.test' }
      }
    }
  })

  assert.deepEqual(result.columns.map(column => column.key), [
    'context_id', 'name', 'description', 'item_count', 'problem_count'
  ])
  assert.deepEqual(result.rows, [{
    context_id: 'context-1',
    name: 'Study',
    description: '',
    item_count: 0,
    problem_count: 0
  }])
})
