import { createXapiSqliteDataset } from '../sources/xapi-sqlite.js'

export const TEACHER_DASHBOARD_VERBS = Object.freeze([
  'assigned',
  'initialized',
  'opened-dashboard',
  'closed-dashboard',
  'toggled_dashboard_view',
  'clicked_exercise_from_highlight'
])

export const TEACHER_DASHBOARD_COLUMNS = Object.freeze([
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
])

const XAPI_DOMAIN = 'xapi.knowlearning.systems'
const XAPI_QUERY = 'statements-by-domain-and-verbs'
const ROSTER_QUERY = 'student-teacher-class-ids'
const ROW_KEY_COLUMNS = TEACHER_DASHBOARD_COLUMNS.map(column => column.key)
const DISPLAY_NAMES = Object.fromEntries(
  TEACHER_DASHBOARD_COLUMNS.map(column => [column.key, column.label])
)

const ASSIGNMENT_CTES = `
safe_statements AS (
  SELECT
    s.*,
    julianday(s.stored) AS event_jd,
    COALESCE(NULLIF(s.actor, ''), NULLIF(s.authority, ''), '') AS statement_user,
    CASE
      WHEN json_valid(COALESCE(s.extensions, ''))
        THEN CASE
          WHEN json_type(s.extensions) = 'object' THEN s.extensions
          ELSE '{}'
        END
      ELSE '{}'
    END AS extensions_json,
    CASE
      WHEN json_valid(COALESCE(s.embed_path, ''))
        THEN CASE
          WHEN json_type(s.embed_path) = 'array' THEN s.embed_path
          ELSE '[]'
        END
      ELSE '[]'
    END AS embed_path_json
  FROM statements s
),
assigned_with_previous AS (
  SELECT
    s.*,
    LAG(s.object) OVER (
      PARTITION BY s.source
      ORDER BY (s.event_jd IS NOT NULL), s.event_jd, s.id
    ) AS previous_object
  FROM safe_statements s
  WHERE s.verb = 'assigned'
    AND s.source IS NOT NULL
    AND s.source <> ''
    AND s.object IS NOT NULL
    AND s.object <> ''
),
assigned_with_runs AS (
  SELECT
    s.*,
    SUM(
      CASE
        WHEN s.previous_object IS NULL OR s.previous_object <> s.object THEN 1
        ELSE 0
      END
    ) OVER (
      PARTITION BY s.source
      ORDER BY (s.event_jd IS NOT NULL), s.event_jd, s.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS sequence_run
  FROM assigned_with_previous s
),
assigned_ranked AS (
  SELECT
    s.*,
    ROW_NUMBER() OVER (
      PARTITION BY s.source
      ORDER BY (s.event_jd IS NOT NULL) DESC, s.event_jd DESC, s.id DESC
    ) AS latest_rank,
    FIRST_VALUE(s.stored) OVER (
      PARTITION BY s.source, s.sequence_run
      ORDER BY (s.event_jd IS NOT NULL), s.event_jd, s.id
    ) AS period_start_stored,
    FIRST_VALUE(s.id) OVER (
      PARTITION BY s.source, s.sequence_run
      ORDER BY (s.event_jd IS NOT NULL), s.event_jd, s.id
    ) AS period_start_id,
    FIRST_VALUE(s.event_jd) OVER (
      PARTITION BY s.source, s.sequence_run
      ORDER BY (s.event_jd IS NOT NULL), s.event_jd, s.id
    ) AS period_start_jd
  FROM assigned_with_runs s
),
assignment_count_values AS (
  SELECT
    s.*,
    json_type(
      s.extensions_json,
      '$.numberOfStudentsAssigned'
    ) AS count_type,
    json_extract(
      s.extensions_json,
      '$.numberOfStudentsAssigned'
    ) AS count_value
  FROM assigned_ranked s
  WHERE s.latest_rank = 1
),
assignment_count_candidates AS (
  SELECT
    s.*,
    CASE
      WHEN s.count_type IN ('integer', 'real') THEN s.count_value
      WHEN s.count_type = 'text'
        THEN CASE
          WHEN json_valid(CAST(s.count_value AS TEXT))
            THEN CASE
              WHEN json_type(CAST(s.count_value AS TEXT)) IN ('integer', 'real')
                THEN json_extract(CAST(s.count_value AS TEXT), '$')
            END
        END
    END AS count_candidate
  FROM assignment_count_values s
),
assignments AS (
  SELECT
    s.source AS assignment_id,
    s.object AS sequence_id,
    s.statement_user AS teacher_id,
    s.extensions_json,
    s.stored AS latest_assignment_stored,
    s.period_start_stored,
    s.period_start_id,
    s.period_start_jd,
    CASE
      WHEN s.count_candidate IS NOT NULL
        AND s.count_candidate >= 0
        AND s.count_candidate <= 9007199254740991
        AND s.count_candidate = CAST(s.count_candidate AS INTEGER)
        THEN CAST(s.count_candidate AS INTEGER)
    END AS extension_student_count
  FROM assignment_count_candidates s
)`

const ASSIGNMENT_PREFLIGHT_QUERY = `
WITH
${ASSIGNMENT_CTES}
SELECT
  sequence_id,
  MAX(extension_student_count IS NULL) AS needs_roster
FROM assignments
GROUP BY sequence_id
ORDER BY sequence_id
`

const TEACHER_DASHBOARD_QUERY = `
WITH
${ASSIGNMENT_CTES},
assignment_classes AS (
  SELECT DISTINCT
    a.assignment_id,
    CAST(j.value AS TEXT) AS class_id
  FROM assignments a
  CROSS JOIN json_each(
    CASE
      WHEN json_type(a.extensions_json, '$.assignedClassIds') = 'array'
        THEN json_extract(a.extensions_json, '$.assignedClassIds')
      ELSE '[]'
    END
  ) j
  WHERE j.value IS NOT NULL
    AND CAST(j.value AS TEXT) <> ''
),
assignment_class_windows AS (
  SELECT
    ac.assignment_id,
    group_concat(ac.class_id, '; ') OVER (
      PARTITION BY ac.assignment_id
      ORDER BY ac.class_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS class_ids,
    ROW_NUMBER() OVER (
      PARTITION BY ac.assignment_id
      ORDER BY ac.class_id DESC
    ) AS pick_rank
  FROM assignment_classes ac
),
assignment_class_lists AS (
  SELECT assignment_id, class_ids
  FROM assignment_class_windows
  WHERE pick_rank = 1
),
roster_student_counts AS (
  SELECT
    ac.assignment_id,
    COUNT(DISTINCT r.student_id) AS roster_student_count
  FROM assignment_classes ac
  JOIN roster r ON r.class_id = ac.class_id
  WHERE r.student_id IS NOT NULL
    AND r.student_id <> ''
  GROUP BY ac.assignment_id
),
lifecycle_events AS (
  SELECT
    s.id,
    a.assignment_id,
    a.sequence_id,
    s.verb,
    s.event_jd
  FROM safe_statements s
  JOIN assignments a ON a.assignment_id = s.object
  WHERE s.verb IN ('opened-dashboard', 'closed-dashboard')
    AND json_extract(s.extensions_json, '$.dashboard')
      IN ('activity', 'live-monitoring')
    AND s.statement_user = a.teacher_id
    AND s.event_jd IS NOT NULL
    AND (a.period_start_jd IS NULL OR s.event_jd >= a.period_start_jd)
),
lifecycle_metrics AS (
  SELECT
    assignment_id,
    SUM(verb = 'opened-dashboard') AS dashboard_open_count,
    SUM(verb = 'closed-dashboard') AS dashboard_close_count
  FROM lifecycle_events
  GROUP BY assignment_id
),
lifecycle_segmented AS (
  SELECT
    e.*,
    COALESCE(
      SUM(e.verb = 'closed-dashboard') OVER (
        PARTITION BY e.assignment_id
        ORDER BY e.event_jd, e.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS close_group
  FROM lifecycle_events e
),
ranked_open_candidates AS (
  SELECT
    e.*,
    ROW_NUMBER() OVER (
      PARTITION BY e.assignment_id, e.close_group
      ORDER BY e.event_jd DESC, e.id DESC
    ) AS open_rank
  FROM lifecycle_segmented e
  WHERE e.verb = 'opened-dashboard'
),
sessions AS (
  SELECT
    c.assignment_id,
    c.sequence_id,
    c.id AS session_id,
    o.id AS opened_id,
    c.id AS closed_id,
    o.event_jd AS opened_jd,
    c.event_jd AS closed_jd
  FROM lifecycle_segmented c
  JOIN ranked_open_candidates o
    ON o.assignment_id = c.assignment_id
    AND o.close_group = c.close_group
    AND o.open_rank = 1
  WHERE c.verb = 'closed-dashboard'
),
sequence_event_base AS (
  SELECT
    s.id AS event_id,
    s.verb,
    s.object,
    s.event_jd,
    s.extensions_json,
    s.embed_path_json
  FROM safe_statements s
  WHERE s.verb IN (
    'toggled_dashboard_view',
    'clicked_exercise_from_highlight'
  )
    AND s.event_jd IS NOT NULL
),
explicit_event_assignment_candidates AS (
  SELECT
    e.event_id,
    a.assignment_id,
    CAST(p.key AS INTEGER) AS path_index,
    ROW_NUMBER() OVER (
      PARTITION BY e.event_id
      ORDER BY CAST(p.key AS INTEGER)
    ) AS explicit_rank
  FROM sequence_event_base e
  CROSS JOIN json_each(e.embed_path_json) p
  JOIN assignments a ON a.assignment_id = CAST(p.value AS TEXT)
),
explicit_event_assignments AS (
  SELECT event_id, assignment_id
  FROM explicit_event_assignment_candidates
  WHERE explicit_rank = 1
),
explicit_attributed_events AS (
  SELECT
    e.event_id,
    e.verb,
    e.object,
    e.event_jd,
    e.extensions_json,
    x.assignment_id
  FROM sequence_event_base e
  JOIN explicit_event_assignments x ON x.event_id = e.event_id
  JOIN assignments a ON a.assignment_id = x.assignment_id
  WHERE e.object = a.sequence_id
    AND (a.period_start_jd IS NULL OR e.event_jd >= a.period_start_jd)
),
fallback_event_session_candidates AS (
  SELECT
    e.event_id,
    s.assignment_id
  FROM sequence_event_base e
  JOIN sessions s
    ON s.sequence_id = e.object
    AND (
      e.event_jd > s.opened_jd
      OR (e.event_jd = s.opened_jd AND e.event_id >= s.opened_id)
    )
    AND (
      e.event_jd < s.closed_jd
      OR (e.event_jd = s.closed_jd AND e.event_id <= s.closed_id)
    )
  LEFT JOIN explicit_event_assignments x ON x.event_id = e.event_id
  WHERE e.verb = 'toggled_dashboard_view'
    AND x.event_id IS NULL
),
unique_fallback_event_assignments AS (
  SELECT
    event_id,
    MIN(assignment_id) AS assignment_id
  FROM fallback_event_session_candidates
  GROUP BY event_id
  HAVING COUNT(DISTINCT assignment_id) = 1
),
fallback_attributed_events AS (
  SELECT
    e.event_id,
    e.verb,
    e.object,
    e.event_jd,
    e.extensions_json,
    u.assignment_id
  FROM sequence_event_base e
  JOIN unique_fallback_event_assignments u ON u.event_id = e.event_id
),
attributed_sequence_events AS (
  SELECT * FROM explicit_attributed_events
  UNION ALL
  SELECT * FROM fallback_attributed_events
),
valid_toggles AS (
  SELECT
    e.*,
    json_extract(e.extensions_json, '$.newView') AS new_view
  FROM attributed_sequence_events e
  WHERE e.verb = 'toggled_dashboard_view'
    AND json_extract(e.extensions_json, '$.previousView')
      IN ('detailed', 'aggregated')
    AND json_extract(e.extensions_json, '$.newView')
      IN ('detailed', 'aggregated')
    AND json_extract(e.extensions_json, '$.previousView')
      <> json_extract(e.extensions_json, '$.newView')
),
toggle_metrics AS (
  SELECT
    assignment_id,
    COUNT(*) AS dashboard_view_clicks
  FROM valid_toggles
  GROUP BY assignment_id
),
simple_attributed_click_events AS (
  SELECT
    event_id,
    assignment_id
  FROM explicit_attributed_events
  WHERE verb = 'clicked_exercise_from_highlight'
  UNION ALL
  SELECT
    e.event_id,
    a.assignment_id
  FROM sequence_event_base e
  JOIN assignments a ON a.sequence_id = e.object
  LEFT JOIN explicit_event_assignments x ON x.event_id = e.event_id
  WHERE e.verb = 'clicked_exercise_from_highlight'
    AND x.event_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(e.embed_path_json) p
      WHERE CAST(p.value AS TEXT) NOT LIKE 'http://%'
        AND CAST(p.value AS TEXT) NOT LIKE 'https://%'
    )
    AND (a.period_start_jd IS NULL OR e.event_jd >= a.period_start_jd)
),
aggregated_click_metrics AS (
  SELECT
    assignment_id,
    COUNT(*) AS aggregated_exercise_clicks
  FROM simple_attributed_click_events
  GROUP BY assignment_id
),
session_boundaries AS (
  SELECT
    s.assignment_id,
    s.session_id,
    s.opened_jd AS boundary_jd,
    0 AS boundary_kind,
    '' AS boundary_id,
    'detailed' AS active_view,
    s.closed_jd
  FROM sessions s
  UNION ALL
  SELECT
    s.assignment_id,
    s.session_id,
    t.event_jd,
    1,
    t.event_id,
    t.new_view,
    s.closed_jd
  FROM sessions s
  JOIN valid_toggles t
    ON t.assignment_id = s.assignment_id
    AND (
      t.event_jd > s.opened_jd
      OR (t.event_jd = s.opened_jd AND t.event_id >= s.opened_id)
    )
    AND (
      t.event_jd < s.closed_jd
      OR (t.event_jd = s.closed_jd AND t.event_id <= s.closed_id)
    )
),
boundary_intervals AS (
  SELECT
    b.*,
    LEAD(b.boundary_jd, 1, b.closed_jd) OVER (
      PARTITION BY b.assignment_id, b.session_id
      ORDER BY b.boundary_jd, b.boundary_kind, b.boundary_id
    ) AS next_boundary_jd
  FROM session_boundaries b
),
dashboard_duration_metrics AS (
  SELECT
    assignment_id,
    CAST(
      ROUND(
        SUM(
          CASE
            WHEN active_view = 'detailed'
              THEN MAX(0, (next_boundary_jd - boundary_jd) * 86400.0)
            ELSE 0
          END
        )
      ) AS INTEGER
    ) AS live_dashboard_seconds,
    CAST(
      ROUND(
        SUM(
          CASE
            WHEN active_view = 'aggregated'
              THEN MAX(0, (next_boundary_jd - boundary_jd) * 86400.0)
            ELSE 0
          END
        )
      ) AS INTEGER
    ) AS summary_dashboard_seconds
  FROM boundary_intervals
  GROUP BY assignment_id
),
initialization_assignment_candidates AS (
  SELECT
    s.id AS event_id,
    s.object,
    s.statement_user,
    s.event_jd,
    s.embed_path_json,
    a.assignment_id,
    a.sequence_id,
    a.teacher_id,
    a.period_start_jd
  FROM safe_statements s
  CROSS JOIN json_each(s.embed_path_json) assignment_path
  JOIN assignments a
    ON a.assignment_id = CAST(assignment_path.value AS TEXT)
  WHERE s.verb = 'initialized'
    AND s.event_jd IS NOT NULL
),
initialization_metrics AS (
  SELECT
    a.assignment_id,
    1 AS started
  FROM initialization_assignment_candidates a
  WHERE (a.period_start_jd IS NULL OR a.event_jd >= a.period_start_jd)
    AND a.statement_user <> a.teacher_id
    AND (
      a.object = a.sequence_id
      OR EXISTS (
        SELECT 1
        FROM json_each(a.embed_path_json) p
        WHERE CAST(p.value AS TEXT) = a.sequence_id
      )
    )
  GROUP BY a.assignment_id
)
SELECT
  a.teacher_id AS teacher_id,
  a.assignment_id AS assignment_id,
  a.sequence_id AS sequence_id,
  COALESCE(sn.sequence_name, '') AS sequence_name,
  COALESCE(
    NULLIF(a.period_start_stored, ''),
    a.latest_assignment_stored,
    ''
  ) AS timestamp_assigned,
  COALESCE(
    a.extension_student_count,
    rc.roster_student_count,
    0
  ) AS students_assigned,
  COALESCE(cl.class_ids, '') AS class_ids,
  COALESCE(i.started, 0) AS started,
  COALESCE(dm.live_dashboard_seconds, 0) AS live_dashboard_seconds,
  COALESCE(dm.summary_dashboard_seconds, 0) AS summary_dashboard_seconds,
  COALESCE(tm.dashboard_view_clicks, 0) AS dashboard_view_clicks,
  COALESCE(cm.aggregated_exercise_clicks, 0) AS aggregated_exercise_clicks,
  COALESCE(lm.dashboard_open_count, 0) AS dashboard_open_count,
  COALESCE(lm.dashboard_close_count, 0) AS dashboard_close_count
FROM assignments a
LEFT JOIN sequence_names sn ON sn.sequence_id = a.sequence_id
LEFT JOIN assignment_class_lists cl ON cl.assignment_id = a.assignment_id
LEFT JOIN roster_student_counts rc ON rc.assignment_id = a.assignment_id
LEFT JOIN initialization_metrics i ON i.assignment_id = a.assignment_id
LEFT JOIN dashboard_duration_metrics dm ON dm.assignment_id = a.assignment_id
LEFT JOIN toggle_metrics tm ON tm.assignment_id = a.assignment_id
LEFT JOIN aggregated_click_metrics cm ON cm.assignment_id = a.assignment_id
LEFT JOIN lifecycle_metrics lm ON lm.assignment_id = a.assignment_id
ORDER BY
  (a.period_start_jd IS NOT NULL),
  a.period_start_jd,
  a.period_start_id,
  a.assignment_id
`

function queryRows(db, query) {
  const statement = db.prepare(query)
  const rows = []

  try {
    while (statement.step()) {
      rows.push(statement.getAsObject())
    }
  } finally {
    statement.free()
  }

  return rows
}

function createDashboardIndexes(db) {
  db.run(`
    CREATE INDEX teacher_dashboard_statements_by_source
    ON statements (verb, source, stored, id)
  `)
  db.run(`
    CREATE INDEX teacher_dashboard_statements_by_object
    ON statements (verb, object, stored, id)
  `)
}

function parseJson(value) {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function getRosterValue(row, snakeCaseKey, camelCaseKey) {
  return row?.[snakeCaseKey] ?? row?.[camelCaseKey] ?? ''
}

function isArchivedRosterRow(row) {
  const classArchived = parseJson(
    getRosterValue(row, 'class_archived', 'classArchived')
  )
  const memberArchived = parseJson(
    getRosterValue(row, 'member_archived', 'memberArchived')
  )

  return (
    classArchived === true
    || (
      memberArchived !== null
      && memberArchived !== undefined
      && memberArchived !== ''
      && memberArchived !== false
    )
  )
}

async function getSequenceNames(sequenceIds, agent) {
  return Promise.all(
    sequenceIds.map(async sequenceId => {
      try {
        const state = await agent.state(sequenceId)
        return [sequenceId, String(state?.name || state?.title || '')]
      } catch {
        return [sequenceId, '']
      }
    })
  )
}

function createSupportTables(db, sequenceNames, rosterRows) {
  db.run(`
    CREATE TABLE sequence_names (
      sequence_id TEXT PRIMARY KEY,
      sequence_name TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE roster (
      class_id TEXT NOT NULL,
      student_id TEXT NOT NULL
    )
  `)

  const insertSequenceName = db.prepare(`
    INSERT INTO sequence_names (sequence_id, sequence_name)
    VALUES (?, ?)
  `)
  const insertRosterRow = db.prepare(`
    INSERT INTO roster (class_id, student_id)
    VALUES (?, ?)
  `)

  try {
    for (const entry of sequenceNames) {
      insertSequenceName.run(entry)
    }

    for (const row of rosterRows) {
      if (isArchivedRosterRow(row)) continue

      const classId = getRosterValue(row, 'class_id', 'classId')
      const studentId = getRosterValue(row, 'student_id', 'studentId')
      if (!classId || !studentId) continue

      insertRosterRow.run([String(classId), String(studentId)])
    }
  } finally {
    insertSequenceName.free()
    insertRosterRow.free()
  }

  db.run(`
    CREATE INDEX teacher_dashboard_roster_by_class
    ON roster (class_id, student_id)
  `)
}

export default {
  id: 'teacher-dashboard-usage',
  title: 'Teacher Dashboard Usage',
  group: 'Study Info',
  description: 'Assignment and teacher dashboard usage metrics for an entire origin domain.',
  sourceType: 'xapi-sqlite',
  parameterSchema: [
    {
      key: 'domain',
      label: 'Domain',
      type: 'text',
      required: true
    }
  ],
  async run({ params, agent, SQLite }) {
    const statements = await agent.query(
      XAPI_QUERY,
      [params.domain, TEACHER_DASHBOARD_VERBS],
      XAPI_DOMAIN
    )
    const dataset = createXapiSqliteDataset(
      statements,
      SQLite,
      { includeRawData: false }
    )
    createDashboardIndexes(dataset.db)
    const assignmentRows = queryRows(dataset.db, ASSIGNMENT_PREFLIGHT_QUERY)
    const sequenceIds = assignmentRows.map(row => row.sequence_id)
    const needsRosterFallback = assignmentRows.some(row => row.needs_roster === 1)
    const [rosterRows, sequenceNames] = await Promise.all([
      needsRosterFallback
        ? agent.query(ROSTER_QUERY, [], params.domain)
        : Promise.resolve([]),
      getSequenceNames(sequenceIds, agent)
    ])

    createSupportTables(dataset.db, sequenceNames, rosterRows)

    return {
      mode: 'sql-plan',
      dataset,
      rowKeyColumns: ROW_KEY_COLUMNS,
      displayNames: DISPLAY_NAMES,
      rowKeyQuery: TEACHER_DASHBOARD_QUERY,
      transformRows(rows) {
        return rows.map(row => ({
          ...row,
          started: row.started === 1
        }))
      }
    }
  }
}
