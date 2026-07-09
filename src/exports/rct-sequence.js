import { getCorrectAnswerText, getStudentAnswerText } from './rct-utils.js'
import { toSqlLiteral, toSqlList } from './sql-utils.js'

export default {
  id: 'rct-student-sequence-data',
  title: 'Student Sequence Data',
  group: 'RCT Sequence',
  description: 'Per-student per-item sequence outcomes and interaction metrics.',
  sourceType: 'xapi-sqlite',
  contextParameterKey: 'contextId',
  defaultDomain: 'xapi.knowlearning.systems',
  supportsRawDownload: true,
  parameterSchema: [
    {
      key: 'contextId',
      label: 'Sequence ID',
      type: 'text',
      required: true,
      defaultValue: 'b81b3af0-9af6-11f0-bb3f-f559dff26704'
    }
  ],
  async run({ params, agent }) {
    const state = await agent.state(params.contextId)
    const problemIds = state.problemIds || []
    const itemPositionCase = problemIds.length > 0
      ? `CASE object
          ${problemIds.map((id, index) => `WHEN '${id}' THEN ${index}`).join('\n')}
          ELSE NULL
        END`
      : 'NULL'

    const problems = await Promise.all(
      problemIds.map(async id => ({
        id,
        ...(await agent.state(id))
      }))
    )

    const correctAnswers = problems.map(problem => getCorrectAnswerText(problem))
    const misconceptions = state.misconceptions || []
    const problemMisconceptionNames = problems.map(problem => {
      const problemMisconceptionsIds = problem.misconceptions || []
      const problemMisconceptions = problemMisconceptionsIds.map(misconceptionId => misconceptions[misconceptionId]).filter(a => !!a);
      return problemMisconceptions.map(m => m.name).join('; ')
    });

    const misconceptionNamesCase = problems.length > 0
      ? `CASE object
          ${problems.map((problem, index) => `WHEN '${problem.id}' THEN ${toSqlLiteral(problemMisconceptionNames[index])}`).join('\n')}
          ELSE NULL
        END`
      : 'NULL'

    const problemKindCase = problems.length > 0
      ? `CASE object
          ${problems.map(problem => `WHEN '${problem.id}' THEN ${toSqlLiteral(problem.kind)}`).join('\n')}
          ELSE 'unknown'
        END`
      : `'unknown'`
    const correctAnswerCase = problems.length > 0
      ? `CASE object
          ${problems.map((problem, index) => `WHEN '${problem.id}' THEN ${toSqlLiteral(correctAnswers[index])}`).join('\n')}
          ELSE NULL
        END`
      : 'NULL'

    const itemCannonicalIds = problems.map(problem => problem.canonicalId || problem.cannonicalId).filter(Boolean);
    const itemCannonicalIdCase = itemCannonicalIds.length > 0
      ? `CASE object
          ${problems.map(problem => `WHEN '${problem.id}' THEN ${toSqlLiteral(problem.canonicalId)}`).join('\n')}
          ELSE NULL
        END`
      : 'NULL'

    const problemDifficultyCase = problems.length > 0
      ? `CASE object
          ${problems.map(problem => `WHEN '${problem.id}' THEN ${toSqlLiteral(problem.difficulty)}`).join('\n')}
          ELSE 'unknown'
        END`
      : `'unknown'`

    const objectFilter = problemIds.length > 0
      ? `AND object IN (${toSqlList(problemIds)})`
      : 'AND 1 = 0'
    const sequenceName = state.name || 'Unknown Sequence'
    const sequenceDescription = state.description || ''

    return {
      mode: 'sql-plan',
      displayNames: {
        student_id: 'user ID',
        sequence_id: 'sequence ID',
        assignment_id: 'assignment ID',
        item_id: 'item ID'
      },
      rowKeyColumns: ['student_id', 'sequence_id', 'assignment_id', 'item_id'],
      rowKeyQuery: `SELECT DISTINCT
        authority AS student_id,
        ${toSqlLiteral(params.contextId)} AS sequence_id,
        json_extract(embed_path, '$[0]') AS assignment_id,
        object AS item_id
      FROM statements
      WHERE json_array_length(embed_path) = 2
        ${objectFilter}
      ORDER BY assignment_id, student_id, ${itemPositionCase};`,
      rowScopeQuery: `SELECT * FROM statements
        WHERE authority = $student_id
          AND json_extract(embed_path, '$[0]') = $assignment_id
          AND (
            object = $item_id
            OR (
              object = $sequence_id
              AND verb IN ('attempt_timeout', 'review_timeout')
            )
          )`,
      derivedColumns: [
        {
          key: 'Item Canonical ID',
          label: 'Item Canonical ID',
          query: `SELECT ${itemCannonicalIdCase} AS value FROM statements LIMIT 1`
        },
        {
          key: 'Sequence Name',
          label: 'Sequence Name',
          query: `SELECT ${toSqlLiteral(sequenceName)} AS value`
        },
        {
          key: 'Item Position',
          label: 'Item Position',
          query: `SELECT ${itemPositionCase} AS value FROM statements LIMIT 1`
        },
        {
          key: 'Item Type',
          label: 'Item Type',
          query: `SELECT ${problemKindCase} AS value FROM statements LIMIT 1`
        },
        {
          key: 'Item Difficulty',
          label: 'Item Difficulty',
          query: `SELECT ${problemDifficultyCase} AS value FROM statements LIMIT 1`
        },
        {
          key: 'Item Misconceptions',
          label: 'Item Misconceptions',
          query: `SELECT ${misconceptionNamesCase} AS value FROM statements LIMIT 1`
        },
        {
          key: 'Date',
          label: 'Date',
          query: `SELECT DATE(stored) AS value FROM statements WHERE verb = 'initialized' ORDER BY stored ASC LIMIT 1`
        },
        {
          key: 'Time stamp',
          label: 'Time stamp',
          query: `SELECT stored AS value FROM statements WHERE verb = 'initialized' ORDER BY stored ASC LIMIT 1`
        },
        {
          key: 'Answer 1',
          label: 'Answer 1',
          query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored ASC LIMIT 1`,
          transform: (value, rowContext) => {
            const problem = problems.find(problemItem => problemItem.id === rowContext.item_id)
            return getStudentAnswerText(value, problem)
          }
        },
        {
          key: 'Answer 2',
          label: 'Answer 2',
          query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored ASC LIMIT 1 OFFSET 1`,
          transform: (value, rowContext) => {
            const problem = problems.find(problemItem => problemItem.id === rowContext.item_id)
            return getStudentAnswerText(value, problem)
          }
        },
        {
          key: 'Answer 3',
          label: 'Answer 3',
          query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored ASC LIMIT 1 OFFSET 2`,
          transform: (value, rowContext) => {
            const problem = problems.find(problemItem => problemItem.id === rowContext.item_id)
            return getStudentAnswerText(value, problem)
          }
        },
        {
          key: 'Final answer',
          label: 'Final answer',
          query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored DESC LIMIT 1`,
          transform: (value, rowContext) => {
            const problem = problems.find(problemItem => problemItem.id === rowContext.item_id)
            return getStudentAnswerText(value, problem)
          }
        },
        {
          key: 'Correct answer',
          label: 'Correct answer',
          query: `SELECT ${correctAnswerCase} AS value FROM statements LIMIT 1`
        },
        {
          key: 'Attempts',
          label: 'Attempts',
          query: `SELECT COUNT(*) AS value FROM statements WHERE verb = 'submitted'`
        },
        {
          key: 'Item skipped',
          label: 'Item skipped',
          query: `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS value FROM statements WHERE verb = 'skipped'`
        },
        {
          key: 'Item reached',
          label: 'Item reached',
          query: `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS value FROM statements WHERE verb = 'initialized'`
        },
        {
          key: 'Correct',
          label: 'Correct',
          query: `SELECT
                    COALESCE(json_extract(extensions, '$.runState.isCorrect'), 0) AS value
                  FROM statements
                  WHERE verb = 'submitted'
                  ORDER BY stored DESC
                  LIMIT 1;`
        },
        {
          key: 'Hands raised',
          label: 'Hands raised',
          query: `SELECT COUNT(*) AS value FROM statements WHERE verb = 'hand_raised'`
        },
        {
          key: 'Time spent on item (exercise) in seconds',
          label: 'Time spent on item (exercise) in seconds',
          query: `
              WITH sessions AS (
                SELECT
                  verb,
                  stored,
                  SUM(CASE WHEN verb = 'initialized' THEN 1 ELSE 0 END)
                    OVER (ORDER BY stored ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_id
                FROM statements
                WHERE verb IN ('initialized', 'submitted', 'skipped', 'attempt_timeout_on_problem', 'heartbeat')
              ),
              session_times AS (
                SELECT
                  session_id,
                  MIN(CASE WHEN verb = 'initialized' THEN stored END) AS start_time,
                  COALESCE(
                    MAX(CASE WHEN verb = 'attempt_timeout_on_problem' THEN stored END),
                    MAX(CASE WHEN verb = 'skipped' THEN stored END),
                    MAX(CASE WHEN verb IN ('submitted', 'heartbeat') THEN stored END)
                  ) AS end_time
                FROM sessions
                GROUP BY session_id
              )
              SELECT COALESCE(CAST(SUM(
                (julianday(end_time) - julianday(start_time)) * 86400
              ) AS INTEGER), 0) AS value
              FROM session_times
              WHERE start_time IS NOT NULL AND end_time > start_time
            `
        },
        {
          key: 'attempt_timeout',
          label: 'attempt_timeout',
          query: `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS value
            FROM statements
            WHERE verb = 'attempt_timeout'`
        },
        {
          key: '# of messages sent (student)',
          label: '# of messages sent (student)',
          query: `SELECT COUNT(*) AS value FROM statements WHERE json_extract(extensions, '$.chatbotEvent.userPrompt') IS NOT NULL`
        },
        {
          key: '# of messages sent (chatbot)',
          label: '# of messages sent (chatbot)',
          query: `SELECT COUNT(*) AS value FROM statements WHERE json_extract(extensions, '$.chatbotEvent.botResponse') IS NOT NULL`
        },
        {
          key: 'Student initiated chat',
          label: 'Student initiated chat',
          query: `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS value FROM statements WHERE json_extract(extensions, '$.chatbotEvent.userPrompt') IS NOT NULL`
        },
        {
          key: 'timestamp of first interaction with chatbot',
          label: 'timestamp of first interaction with chatbot',
          query: `SELECT json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp') as value FROM statements WHERE json_extract(extensions, '$.chatbotEvent.userPrompt') IS NOT NULL ORDER BY stored ASC LIMIT 1`
        }
      ]
    }
  }
}
