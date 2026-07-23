import test from 'node:test'
import assert from 'node:assert/strict'
import initSqlJs from 'sql.js'

import { executeExport, normalizeParams } from '../../src/exports/engine.js'
import { getExportDefinition } from '../../src/exports/registry.js'
import {
  TEACHER_DASHBOARD_COLUMNS,
  TEACHER_DASHBOARD_VERBS
} from '../../src/exports/teacher-dashboard-usage.js'

const DOMAIN = 'district.example.test'
let sqlitePromise

function getSQLite() {
  if (!sqlitePromise) sqlitePromise = initSqlJs()
  return sqlitePromise
}

const EXPECTED_VERBS = [
  'assigned',
  'initialized',
  'opened-dashboard',
  'closed-dashboard',
  'toggled_dashboard_view',
  'clicked_exercise_from_highlight'
]

const EXPECTED_COLUMNS = [
  { key: 'teacher_id', label: 'Teacher ID' },
  { key: 'assignment_id', label: 'Assignment ID' },
  { key: 'sequence_id', label: 'Sequence ID' },
  { key: 'sequence_name', label: 'Sequence name' },
  { key: 'timestamp_assigned', label: 'Timestamp assigned' },
  { key: 'students_assigned', label: 'Number of students assigned' },
  { key: 'class_ids', label: 'Class IDs assigned' },
  { key: 'started', label: 'Started by at least one student' },
  {
    key: 'live_dashboard_seconds',
    label: 'Total time spent on live dashboard (seconds)'
  },
  {
    key: 'summary_dashboard_seconds',
    label: 'Total time spent on summary dashboard (seconds)'
  },
  {
    key: 'dashboard_view_clicks',
    label: 'Clicks between aggregated and live view'
  },
  {
    key: 'aggregated_exercise_clicks',
    label: 'Clicks on exercises in aggregated view'
  },
  { key: 'dashboard_open_count', label: 'Times dashboard was opened' },
  { key: 'dashboard_close_count', label: 'Times dashboard was closed' }
]

test('teacher dashboard usage export is registered with only a required domain parameter', () => {
  const definition = getExportDefinition('teacher-dashboard-usage')

  assert.ok(definition)
  assert.equal(definition.sourceType, 'xapi-sqlite')
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

  assert.deepEqual(TEACHER_DASHBOARD_VERBS, EXPECTED_VERBS)
  assert.deepEqual(TEACHER_DASHBOARD_COLUMNS, EXPECTED_COLUMNS)
})

test('teacher dashboard usage export aggregates assignments, rosters, and dashboard activity', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const assignmentId = '10000000-0000-4000-8000-000000000001'
  const inactiveAssignmentId = '10000000-0000-4000-8000-000000000002'
  const sequenceId = '20000000-0000-4000-8000-000000000001'
  const inactiveSequenceId = '20000000-0000-4000-8000-000000000002'
  const queryCalls = []
  const stateCalls = []

  const statements = [
    {
      id: 'assigned-old',
      source: assignmentId,
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'assigned',
      object: '20000000-0000-4000-8000-000000000099',
      stored: '2026-01-01T08:00:00.000Z',
      extensions: { assignedClassIds: ['class-old'] }
    },
    {
      id: 'initialized-old-sequence',
      source: 'student-old-run-state',
      actor: 'student-old',
      verb: 'initialized',
      object: '20000000-0000-4000-8000-000000000099',
      embed_path: [
        assignmentId,
        '20000000-0000-4000-8000-000000000099'
      ],
      stored: '2026-01-01T08:30:00.000Z',
      extensions: {}
    },
    {
      id: 'assigned-current',
      source: assignmentId,
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T09:00:00.000Z',
      extensions: {
        assignedClassIds: ['class-a', 'class-b']
      }
    },
    {
      id: 'assigned-inactive',
      source: inactiveAssignmentId,
      actor: 'teacher-2',
      authority: 'teacher-2',
      verb: 'assigned',
      object: inactiveSequenceId,
      stored: '2026-01-02T09:30:00.000Z',
      extensions: {
        assignedClassIds: ['class-c']
      }
    },
    {
      id: 'teacher-initialized',
      source: 'teacher-run-state',
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'initialized',
      object: sequenceId,
      embed_path: [assignmentId, sequenceId],
      stored: '2026-01-02T09:55:00.000Z',
      extensions: {}
    },
    {
      id: 'student-initialized',
      source: 'student-run-state',
      actor: 'student-overlap',
      authority: 'student-overlap',
      verb: 'initialized',
      object: 'outer-sequence',
      embed_path: [assignmentId, 'outer-sequence', sequenceId],
      stored: '2026-01-02T09:56:00.000Z',
      extensions: {}
    },
    {
      id: 'unmatched-close',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'closed-dashboard',
      object: assignmentId,
      stored: '2026-01-02T09:58:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'dashboard-open',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'opened-dashboard',
      object: assignmentId,
      stored: '2026-01-02T10:00:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'view-toggle',
      source: sequenceId,
      actor: 'sequence-owner',
      authority: 'sequence-owner',
      verb: 'toggled_dashboard_view',
      object: sequenceId,
      embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
      stored: '2026-01-02T10:02:00.000Z',
      extensions: {
        previousView: 'detailed',
        newView: 'aggregated'
      }
    },
    {
      id: 'aggregated-click-1',
      source: sequenceId,
      actor: 'sequence-owner',
      authority: 'sequence-owner',
      verb: 'clicked_exercise_from_highlight',
      object: sequenceId,
      embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
      stored: '2026-01-02T10:03:00.000Z',
      extensions: {
        exerciseId: 'exercise-1',
        highlightType: 'most_skipped'
      }
    },
    {
      id: 'aggregated-click-2',
      source: sequenceId,
      actor: 'sequence-owner',
      authority: 'sequence-owner',
      verb: 'clicked_exercise_from_highlight',
      object: sequenceId,
      embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
      stored: '2026-01-02T10:04:00.000Z',
      extensions: {
        exerciseId: 'exercise-2',
        highlightType: 'most_incorrect'
      }
    },
    {
      id: 'view-toggle-back',
      source: sequenceId,
      actor: 'sequence-owner',
      authority: 'sequence-owner',
      verb: 'toggled_dashboard_view',
      object: sequenceId,
      embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
      stored: '2026-01-02T10:04:00.000Z',
      extensions: {
        previousView: 'aggregated',
        newView: 'detailed'
      }
    },
    {
      id: 'dashboard-close',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'closed-dashboard',
      object: assignmentId,
      stored: '2026-01-02T10:05:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'unmatched-open',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'opened-dashboard',
      object: assignmentId,
      stored: '2026-01-02T11:00:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'assigned-current-class-update',
      source: assignmentId,
      actor: 'teacher-1',
      authority: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T11:05:00.000Z',
      extensions: {
        assignedClassIds: ['class-b', 'class-a']
      }
    },
    {
      id: 'other-assignment-open',
      actor: 'teacher-elsewhere',
      authority: 'teacher-elsewhere',
      verb: 'opened-dashboard',
      object: 'assignment-not-exported',
      stored: '2026-01-02T12:00:00.000Z',
      extensions: { dashboard: 'activity' }
    },
    {
      id: 'other-assignment-toggle',
      actor: 'teacher-elsewhere',
      authority: 'teacher-elsewhere',
      verb: 'toggled_dashboard_view',
      object: sequenceId,
      embed_path: ['assignment-not-exported', sequenceId],
      stored: '2026-01-02T12:01:00.000Z',
      extensions: {
        previousView: 'detailed',
        newView: 'aggregated'
      }
    },
    {
      id: 'other-assignment-click',
      actor: 'teacher-elsewhere',
      authority: 'teacher-elsewhere',
      verb: 'clicked_exercise_from_highlight',
      object: sequenceId,
      embed_path: ['assignment-not-exported', sequenceId],
      stored: '2026-01-02T12:02:00.000Z',
      extensions: {
        exerciseId: 'exercise-elsewhere',
        highlightType: 'most_skipped'
      }
    }
  ]

  const rosterRows = [
    {
      student_id: 'student-a',
      teacher_id: 'teacher-1',
      class_id: 'class-a'
    },
    {
      student_id: 'student-overlap',
      teacher_id: 'teacher-1',
      class_id: 'class-a'
    },
    {
      student_id: 'student-overlap',
      teacher_id: 'teacher-1',
      class_id: 'class-b'
    },
    {
      student_id: 'student-b',
      teacher_id: 'teacher-1',
      class_id: 'class-b'
    },
    {
      student_id: 'student-c',
      teacher_id: 'teacher-2',
      class_id: 'class-c'
    },
    {
      student_id: 'student-elsewhere',
      teacher_id: 'teacher-elsewhere',
      class_id: 'class-not-assigned'
    }
  ]

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name, args, domain) {
        queryCalls.push({ name, args, domain })

        if (name === 'statements-by-domain-and-verbs') {
          return statements
        }

        if (name === 'student-teacher-class-ids') {
          return rosterRows
        }

        throw new Error(`Unexpected query: ${name}`)
      },
      async state(id) {
        stateCalls.push(id)

        if (id === sequenceId) {
          return { name: 'Active sequence' }
        }

        if (id === inactiveSequenceId) {
          return { title: 'Inactive assessment' }
        }

        throw new Error(`Unexpected state lookup: ${id}`)
      }
    }
  })

  assert.deepEqual(queryCalls, [
    {
      name: 'statements-by-domain-and-verbs',
      args: [DOMAIN, EXPECTED_VERBS],
      domain: 'xapi.knowlearning.systems'
    },
    {
      name: 'student-teacher-class-ids',
      args: [],
      domain: DOMAIN
    }
  ])
  assert.deepEqual(
    [...stateCalls].sort(),
    [inactiveSequenceId, sequenceId].sort()
  )
  assert.deepEqual(execution.result.columns, EXPECTED_COLUMNS)
  assert.equal(execution.result.meta.rowCount, 2)

  const rowsByAssignment = new Map(
    execution.result.rows.map(row => [row.assignment_id, row])
  )

  assert.deepEqual(rowsByAssignment.get(assignmentId), {
    teacher_id: 'teacher-1',
    assignment_id: assignmentId,
    sequence_id: sequenceId,
    sequence_name: 'Active sequence',
    timestamp_assigned: '2026-01-02T09:00:00.000Z',
    students_assigned: 3,
    class_ids: 'class-a; class-b',
    started: true,
    live_dashboard_seconds: 180,
    summary_dashboard_seconds: 120,
    dashboard_view_clicks: 2,
    aggregated_exercise_clicks: 2,
    dashboard_open_count: 2,
    dashboard_close_count: 2
  })

  assert.deepEqual(rowsByAssignment.get(inactiveAssignmentId), {
    teacher_id: 'teacher-2',
    assignment_id: inactiveAssignmentId,
    sequence_id: inactiveSequenceId,
    sequence_name: 'Inactive assessment',
    timestamp_assigned: '2026-01-02T09:30:00.000Z',
    students_assigned: 1,
    class_ids: 'class-c',
    started: false,
    live_dashboard_seconds: 0,
    summary_dashboard_seconds: 0,
    dashboard_view_clicks: 0,
    aggregated_exercise_clicks: 0,
    dashboard_open_count: 0,
    dashboard_close_count: 0
  })
})

test('teacher dashboard usage export prefers the latest assignment student count and skips the roster query', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const assignmentId = 'assignment-with-count'
  const sequenceId = 'sequence-with-count'
  const queryCalls = []

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name, args, domain) {
        queryCalls.push({ name, args, domain })

        if (name === 'statements-by-domain-and-verbs') {
          return [
            {
              id: 'assigned-with-old-count',
              source: assignmentId,
              actor: 'teacher-1',
              verb: 'assigned',
              object: 'old-sequence',
              stored: '2026-01-01T08:00:00.000Z',
              extensions: {
                assignedClassIds: ['old-class'],
                numberOfStudentsAssigned: 99
              }
            },
            {
              id: 'assigned-with-latest-count',
              source: assignmentId,
              actor: 'teacher-1',
              verb: 'assigned',
              object: sequenceId,
              stored: '2026-01-02T08:00:00.000Z',
              extensions: {
                assignedClassIds: ['class-a'],
                numberOfStudentsAssigned: 0
              }
            }
          ]
        }

        throw new Error(`Unexpected query: ${name}`)
      },
      async state(id) {
        assert.equal(id, sequenceId)
        return { name: 'Sequence with count' }
      }
    }
  })

  assert.deepEqual(queryCalls, [
    {
      name: 'statements-by-domain-and-verbs',
      args: [DOMAIN, EXPECTED_VERBS],
      domain: 'xapi.knowlearning.systems'
    }
  ])
  assert.deepEqual(execution.result.rows, [
    {
      teacher_id: 'teacher-1',
      assignment_id: assignmentId,
      sequence_id: sequenceId,
      sequence_name: 'Sequence with count',
      timestamp_assigned: '2026-01-02T08:00:00.000Z',
      students_assigned: 0,
      class_ids: 'class-a',
      started: false,
      live_dashboard_seconds: 0,
      summary_dashboard_seconds: 0,
      dashboard_view_clicks: 0,
      aggregated_exercise_clicks: 0,
      dashboard_open_count: 0,
      dashboard_close_count: 0
    }
  ])
})

test('teacher dashboard usage export falls back to the roster for an invalid assignment student count', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const assignmentId = 'assignment-with-invalid-count'
  const sequenceId = 'sequence-with-invalid-count'
  const queryCalls = []

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name, args, domain) {
        queryCalls.push({ name, args, domain })

        if (name === 'statements-by-domain-and-verbs') {
          return [
            {
              id: 'assigned-with-invalid-count',
              source: assignmentId,
              actor: 'teacher-1',
              verb: 'assigned',
              object: sequenceId,
              stored: '2026-01-02T08:00:00.000Z',
              extensions: {
                assignedClassIds: ['class-a', 'class-archived'],
                numberOfStudentsAssigned: -1
              }
            }
          ]
        }

        if (name === 'student-teacher-class-ids') {
          return [
            { class_id: 'class-a', student_id: 'student-1' },
            { class_id: 'class-a', student_id: 'student-2' },
            {
              class_id: 'class-a',
              student_id: 'former-student',
              member_removed: true
            },
            {
              class_id: 'class-a',
              student_id: 'legacy-former-student',
              member_archived: '2026-01-01T00:00:00.000Z'
            },
            {
              class_id: 'class-archived',
              student_id: 'student-in-archived-class',
              class_archived: true
            }
          ]
        }

        throw new Error(`Unexpected query: ${name}`)
      },
      async state(id) {
        assert.equal(id, sequenceId)
        return {}
      }
    }
  })

  assert.deepEqual(queryCalls, [
    {
      name: 'statements-by-domain-and-verbs',
      args: [DOMAIN, EXPECTED_VERBS],
      domain: 'xapi.knowlearning.systems'
    },
    {
      name: 'student-teacher-class-ids',
      args: [],
      domain: DOMAIN
    }
  ])
  assert.equal(execution.result.rows[0].students_assigned, 2)
})

test('teacher dashboard usage export times legacy activity sessions with explicit view toggles', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const assignmentId = '10000000-0000-4000-8000-000000000005'
  const sequenceId = '20000000-0000-4000-8000-000000000005'
  const statements = [
    {
      id: 'activity-assigned',
      source: assignmentId,
      actor: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T09:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    {
      id: 'activity-opened',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'opened-dashboard',
      object: assignmentId,
      stored: '2026-01-02T10:00:00.000Z',
      extensions: { dashboard: 'activity' }
    },
    {
      id: 'activity-toggle-summary',
      source: sequenceId,
      actor: 'sequence-owner',
      verb: 'toggled_dashboard_view',
      object: sequenceId,
      embed_path: [assignmentId, sequenceId],
      stored: '2026-01-02T10:02:00.000Z',
      extensions: {
        previousView: 'detailed',
        newView: 'aggregated'
      }
    },
    {
      id: 'activity-toggle-live',
      source: sequenceId,
      actor: 'sequence-owner',
      verb: 'toggled_dashboard_view',
      object: sequenceId,
      embed_path: [assignmentId, sequenceId],
      stored: '2026-01-02T10:05:00.000Z',
      extensions: {
        previousView: 'aggregated',
        newView: 'detailed'
      }
    },
    {
      id: 'activity-closed',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'closed-dashboard',
      object: assignmentId,
      stored: '2026-01-02T10:10:00.000Z',
      extensions: { dashboard: 'activity' }
    }
  ]

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name) {
        assert.equal(name, 'statements-by-domain-and-verbs')
        return statements
      },
      async state(id) {
        assert.equal(id, sequenceId)
        return { name: 'Legacy activity' }
      }
    }
  })
  const [row] = execution.result.rows

  assert.equal(row.dashboard_view_clicks, 2)
  assert.equal(row.live_dashboard_seconds, 420)
  assert.equal(row.summary_dashboard_seconds, 180)
  assert.equal(row.dashboard_open_count, 1)
  assert.equal(row.dashboard_close_count, 1)
})

test('teacher dashboard usage export counts problem clicks without dashboard lifecycle events', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const assignmentId = '10000000-0000-4000-8000-000000000007'
  const sequenceId = '20000000-0000-4000-8000-000000000007'
  const click = (id, stored) => ({
    id,
    source: sequenceId,
    actor: 'sequence-owner',
    verb: 'clicked_exercise_from_highlight',
    object: sequenceId,
    embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
    stored,
    extensions: {
      exerciseId: `exercise-${id}`,
      highlightType: 'most_incorrect'
    }
  })
  const statements = [
    click('before-assignment', '2026-01-02T08:59:00.000Z'),
    {
      id: 'click-only-assigned',
      source: assignmentId,
      actor: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T09:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    click('first', '2026-01-02T10:01:00.000Z'),
    click('second', '2026-01-02T10:02:00.000Z')
  ]

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name) {
        assert.equal(name, 'statements-by-domain-and-verbs')
        return statements
      },
      async state(id) {
        assert.equal(id, sequenceId)
        return {}
      }
    }
  })
  const [row] = execution.result.rows

  assert.equal(row.aggregated_exercise_clicks, 2)
  assert.equal(row.dashboard_view_clicks, 0)
  assert.equal(row.dashboard_open_count, 0)
  assert.equal(row.dashboard_close_count, 0)
})

test('teacher dashboard usage export uses statement IDs to order events tied at session boundaries', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const assignmentId = '10000000-0000-4000-8000-000000000006'
  const sequenceId = '20000000-0000-4000-8000-000000000006'
  const lifecycle = (id, verb, stored) => ({
    id,
    source: `teacher-dashboard-${assignmentId}-xapi`,
    actor: 'teacher-1',
    verb,
    object: assignmentId,
    stored,
    extensions: { dashboard: 'live-monitoring' }
  })
  const statements = [
    {
      id: 'boundary-assigned',
      source: assignmentId,
      actor: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T09:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    lifecycle(
      'boundary-first-open',
      'opened-dashboard',
      '2026-01-02T10:00:00.000Z'
    ),
    lifecycle(
      'boundary-a-close',
      'closed-dashboard',
      '2026-01-02T10:10:00.000Z'
    ),
    {
      id: 'boundary-m-toggle',
      source: sequenceId,
      actor: 'sequence-owner',
      verb: 'toggled_dashboard_view',
      object: sequenceId,
      embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
      stored: '2026-01-02T10:10:00.000Z',
      extensions: {
        previousView: 'detailed',
        newView: 'aggregated'
      }
    },
    lifecycle(
      'boundary-z-open',
      'opened-dashboard',
      '2026-01-02T10:10:00.000Z'
    ),
    lifecycle(
      'boundary-second-close',
      'closed-dashboard',
      '2026-01-02T10:20:00.000Z'
    )
  ]

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name) {
        assert.equal(name, 'statements-by-domain-and-verbs')
        return statements
      },
      async state(id) {
        assert.equal(id, sequenceId)
        return {}
      }
    }
  })
  const [row] = execution.result.rows

  assert.equal(row.dashboard_view_clicks, 0)
  assert.equal(row.live_dashboard_seconds, 1200)
  assert.equal(row.summary_dashboard_seconds, 0)
  assert.equal(row.dashboard_open_count, 2)
  assert.equal(row.dashboard_close_count, 2)
})

test('teacher dashboard usage export counts clicks by sequence while keeping ambiguous toggles excluded', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const sequenceId = '20000000-0000-4000-8000-000000000010'
  const firstAssignmentId = '10000000-0000-4000-8000-000000000010'
  const secondAssignmentId = '10000000-0000-4000-8000-000000000011'
  const statements = [
    {
      id: 'assigned-first',
      source: firstAssignmentId,
      actor: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T09:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    {
      id: 'assigned-second',
      source: secondAssignmentId,
      actor: 'teacher-2',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T09:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    {
      id: 'opened-first',
      source: `teacher-dashboard-${firstAssignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'opened-dashboard',
      object: firstAssignmentId,
      stored: '2026-01-02T10:00:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'opened-second',
      source: `teacher-dashboard-${secondAssignmentId}-xapi`,
      actor: 'teacher-2',
      verb: 'opened-dashboard',
      object: secondAssignmentId,
      stored: '2026-01-02T10:00:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'ambiguous-toggle',
      source: sequenceId,
      actor: 'sequence-owner',
      verb: 'toggled_dashboard_view',
      object: sequenceId,
      embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
      stored: '2026-01-02T10:03:00.000Z',
      extensions: {
        previousView: 'detailed',
        newView: 'aggregated'
      }
    },
    {
      id: 'ambiguous-click',
      source: sequenceId,
      actor: 'sequence-owner',
      verb: 'clicked_exercise_from_highlight',
      object: sequenceId,
      embed_path: ['https://rct-problem-creator.pilaproject.org/dashboard'],
      stored: '2026-01-02T10:04:00.000Z',
      extensions: {
        exerciseId: 'exercise-1',
        highlightType: 'most_skipped'
      }
    },
    {
      id: 'explicit-click',
      source: sequenceId,
      actor: 'sequence-owner',
      verb: 'clicked_exercise_from_highlight',
      object: sequenceId,
      embed_path: [
        'https://rct-problem-creator.pilaproject.org/dashboard',
        firstAssignmentId
      ],
      stored: '2026-01-02T10:05:00.000Z',
      extensions: {
        exerciseId: 'exercise-2',
        highlightType: 'most_incorrect'
      }
    },
    {
      id: 'closed-first',
      source: `teacher-dashboard-${firstAssignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'closed-dashboard',
      object: firstAssignmentId,
      stored: '2026-01-02T10:10:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'closed-second',
      source: `teacher-dashboard-${secondAssignmentId}-xapi`,
      actor: 'teacher-2',
      verb: 'closed-dashboard',
      object: secondAssignmentId,
      stored: '2026-01-02T10:10:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    }
  ]

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name) {
        assert.equal(name, 'statements-by-domain-and-verbs')
        return statements
      },
      async state(id) {
        assert.equal(id, sequenceId)
        return { name: 'Shared sequence' }
      }
    }
  })
  const rows = new Map(
    execution.result.rows.map(row => [row.assignment_id, row])
  )

  assert.equal(rows.get(firstAssignmentId).dashboard_view_clicks, 0)
  assert.equal(rows.get(firstAssignmentId).aggregated_exercise_clicks, 2)
  assert.equal(rows.get(firstAssignmentId).live_dashboard_seconds, 600)
  assert.equal(rows.get(firstAssignmentId).summary_dashboard_seconds, 0)
  assert.equal(rows.get(secondAssignmentId).dashboard_view_clicks, 0)
  assert.equal(rows.get(secondAssignmentId).aggregated_exercise_clicks, 1)
  assert.equal(rows.get(secondAssignmentId).live_dashboard_seconds, 600)
  assert.equal(rows.get(secondAssignmentId).summary_dashboard_seconds, 0)
})

test('teacher dashboard usage export resets activity after a sequence changes away and back', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const assignmentId = '10000000-0000-4000-8000-000000000020'
  const sequenceId = '20000000-0000-4000-8000-000000000020'
  const statements = [
    {
      id: 'assigned-first-a',
      source: assignmentId,
      actor: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T08:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    {
      id: 'old-open',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'opened-dashboard',
      object: assignmentId,
      stored: '2026-01-02T08:10:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'old-close',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'closed-dashboard',
      object: assignmentId,
      stored: '2026-01-02T08:20:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'assigned-b',
      source: assignmentId,
      actor: 'teacher-1',
      verb: 'assigned',
      object: '20000000-0000-4000-8000-000000000021',
      stored: '2026-01-02T09:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    {
      id: 'assigned-second-a',
      source: assignmentId,
      actor: 'teacher-1',
      verb: 'assigned',
      object: sequenceId,
      stored: '2026-01-02T10:00:00.000Z',
      extensions: {
        assignedClassIds: [],
        numberOfStudentsAssigned: 0
      }
    },
    {
      id: 'current-open-replaced',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'opened-dashboard',
      object: assignmentId,
      stored: '2026-01-02T10:10:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'current-open',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'opened-dashboard',
      object: assignmentId,
      stored: '2026-01-02T10:12:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    },
    {
      id: 'current-close',
      source: `teacher-dashboard-${assignmentId}-xapi`,
      actor: 'teacher-1',
      verb: 'closed-dashboard',
      object: assignmentId,
      stored: '2026-01-02T10:20:00.000Z',
      extensions: { dashboard: 'live-monitoring' }
    }
  ]

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name) {
        assert.equal(name, 'statements-by-domain-and-verbs')
        return statements
      },
      async state(id) {
        assert.equal(id, sequenceId)
        return { name: 'Reassigned sequence' }
      }
    }
  })
  const [row] = execution.result.rows

  assert.equal(row.timestamp_assigned, '2026-01-02T10:00:00.000Z')
  assert.equal(row.dashboard_open_count, 2)
  assert.equal(row.dashboard_close_count, 1)
  assert.equal(row.live_dashboard_seconds, 480)
  assert.equal(row.summary_dashboard_seconds, 0)
})

test('teacher dashboard usage export returns its explicit columns when no assignments exist', async () => {
  const definition = getExportDefinition('teacher-dashboard-usage')
  const queryCalls = []

  const execution = await executeExport(definition, {
    rawParams: { domain: DOMAIN },
    environment: {},
    SQLite: await getSQLite(),
    agent: {
      async query(name, args, domain) {
        queryCalls.push({ name, args, domain })
        return []
      },
      async state(id) {
        throw new Error(`Unexpected state lookup: ${id}`)
      }
    }
  })

  assert.deepEqual(queryCalls, [
    {
      name: 'statements-by-domain-and-verbs',
      args: [DOMAIN, EXPECTED_VERBS],
      domain: 'xapi.knowlearning.systems'
    }
  ])
  assert.deepEqual(execution.result.columns, EXPECTED_COLUMNS)
  assert.deepEqual(execution.result.rows, [])
  assert.equal(execution.result.meta.rowCount, 0)
})
