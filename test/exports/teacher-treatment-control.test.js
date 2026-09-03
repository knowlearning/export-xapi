import test from 'node:test'
import assert from 'node:assert/strict'

import { executeExport, normalizeParams } from '../../src/exports/engine.js'
import { getExportDefinition } from '../../src/exports/registry.js'
import {
  CONTROL_TAG_ID,
  DOMAIN_TO_PARTITION,
  TEACHER_TAG_ID,
  TEACHER_TREATMENT_CONTROL_COLUMNS,
  TREATMENT_TAG_ID
} from '../../src/exports/teacher-treatment-control.js'

const TAGS_DOMAIN = 'tags.knowlearning.systems'

test('teacher treatment/control export is registered with a required domain', () => {
  const definition = getExportDefinition('teacher-treatment-control')

  assert.equal(TEACHER_TAG_ID, '49bf66a0-ed49-11ee-be89-5b04faf266ea')
  assert.equal(TREATMENT_TAG_ID, '472a84d0-ab69-11f0-b8c9-a1d0807d9f84')
  assert.equal(CONTROL_TAG_ID, '41ad5640-ab69-11f0-b8c9-a1d0807d9f84')
  assert.equal(
    DOMAIN_TO_PARTITION['france-rct-2025.pilaproject.org'],
    'PILA France RCT 2025'
  )
  assert.ok(definition)
  assert.equal(definition.sourceType, 'direct')
  assert.deepEqual(definition.parameterSchema, [
    {
      key: 'domain',
      label: 'Domain',
      type: 'text',
      required: true
    }
  ])
  assert.throws(
    () => normalizeParams(definition.parameterSchema, {}),
    /Domain is required/
  )
})

test('teacher treatment/control export maps domains and merges taggings by teacher', async () => {
  const definition = getExportDefinition('teacher-treatment-control')
  const calls = []

  const execution = await executeExport(definition, {
    rawParams: {
      domain: ' France-RCT-2025.PILAProject.org '
    },
    environment: {},
    agent: {
      async query(name, args, domain) {
        calls.push({ name, args, domain })

        if (args[1] === TEACHER_TAG_ID) {
          return [
            {
              target: 'teacher-only',
              timestamp: '2025-12-31T10:00:00.000Z'
            },
            {
              target: 'teacher-both',
              timestamp: '2025-12-30T10:00:00.000Z'
            }
          ]
        }

        if (args[1] === TREATMENT_TAG_ID) {
          return [
            {
              target: 'teacher-treatment',
              timestamp: '2026-01-01T10:00:00.000Z'
            },
            {
              target: 'teacher-both',
              timestamp: '2026-01-02T10:00:00.000Z'
            }
          ]
        }

        return [
          {
            target: 'teacher-control',
            timestamp: '2026-01-03T10:00:00.000Z'
          },
          {
            target: 'teacher-both',
            timestamp: '2026-01-04T10:00:00.000Z'
          }
        ]
      }
    }
  })

  const partition = DOMAIN_TO_PARTITION['france-rct-2025.pilaproject.org']
  assert.deepEqual(calls, [
    {
      name: 'taggings-for-tag',
      args: [partition, TEACHER_TAG_ID],
      domain: TAGS_DOMAIN
    },
    {
      name: 'taggings-for-tag',
      args: [partition, TREATMENT_TAG_ID],
      domain: TAGS_DOMAIN
    },
    {
      name: 'taggings-for-tag',
      args: [partition, CONTROL_TAG_ID],
      domain: TAGS_DOMAIN
    }
  ])
  assert.deepEqual(execution.result.columns, TEACHER_TREATMENT_CONTROL_COLUMNS)
  assert.deepEqual(execution.result.rows, [
    {
      teacher: 'teacher-both',
      treatment: true,
      control: true,
      added_to_teacher: '2025-12-30T10:00:00.000Z',
      added_to_treatment: '2026-01-02T10:00:00.000Z',
      added_to_control: '2026-01-04T10:00:00.000Z'
    },
    {
      teacher: 'teacher-control',
      treatment: false,
      control: true,
      added_to_teacher: '',
      added_to_treatment: '',
      added_to_control: '2026-01-03T10:00:00.000Z'
    },
    {
      teacher: 'teacher-only',
      treatment: false,
      control: false,
      added_to_teacher: '2025-12-31T10:00:00.000Z',
      added_to_treatment: '',
      added_to_control: ''
    },
    {
      teacher: 'teacher-treatment',
      treatment: true,
      control: false,
      added_to_teacher: '',
      added_to_treatment: '2026-01-01T10:00:00.000Z',
      added_to_control: ''
    }
  ])
  assert.equal(execution.result.meta.rowCount, 4)
})

test('teacher treatment/control export retains columns when all tag groups are empty', async () => {
  const definition = getExportDefinition('teacher-treatment-control')

  const execution = await executeExport(definition, {
    rawParams: {
      domain: 'app.pilaproject.org'
    },
    environment: {},
    agent: {
      async query() {
        return []
      }
    }
  })

  assert.deepEqual(execution.result.columns, TEACHER_TREATMENT_CONTROL_COLUMNS)
  assert.deepEqual(execution.result.rows, [])
  assert.equal(execution.result.meta.rowCount, 0)
})

test('teacher treatment/control export rejects domains without a partition before querying', async () => {
  const definition = getExportDefinition('teacher-treatment-control')
  let queryCount = 0

  await assert.rejects(
    executeExport(definition, {
      rawParams: {
        domain: 'district.example.test'
      },
      environment: {},
      agent: {
        async query() {
          queryCount += 1
          return []
        }
      }
    }),
    /No tag partition configured for domain "district\.example\.test"/
  )
  assert.equal(queryCount, 0)
})
