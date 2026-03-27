
import { toSqlLiteral } from './sql-utils.js'

export default {
  id: 'survey-responses',
  title: 'Survey Responses',
  group: 'Survey Data',
  description: 'Latest response values and timing metrics by survey assignment.',
  sourceType: 'xapi-sqlite',
  contextParameterKey: 'contextId',
  defaultDomain: 'xapi.knowlearning.systems',
  supportsRawDownload: true,
  parameterSchema: [
    {
      key: 'contextId',
      label: 'Survey Sequence ID',
      type: 'text',
      required: true,
      defaultValue: 'b81b3af0-9af6-11f0-bb3f-f559dff26704'
    }
  ],
  async run({ params, agent }) {
    const sequence = await agent.state(params.contextId)
    const surveyPages = await Promise.all(sequence.items.map(item => agent.state(item.id)))
    const names = surveyPages.map(page => page.formData.map(field => field.name)).flat()

    return {
      mode: 'sql-plan',
      displayNames: { user: 'user ID', assignment: 'assignment ID', completed: 'submission timestamp' },
      rowKeyColumns: ['user', 'assignment'],
      rowKeyQuery: `
        SELECT DISTINCT
          authority AS user,
          json_extract(embed_path, '$[0]') AS assignment
        FROM statements
        WHERE json_array_length(embed_path) = 3`,
      rowScopeQuery: `
        SELECT *
          FROM statements
          WHERE authority = $user AND json_extract(embed_path, '$[0]') = $assignment`,
      derivedColumns: [
        ...names.map(name => ({
          key: name,
          label: name,
          query: `
            SELECT response AS value
              FROM statements
              WHERE verb = 'answered'
                AND json_extract(extensions, '$.item.name') = ${toSqlLiteral(name)}
              ORDER BY stored DESC LIMIT 1`
        })),
        {
          key: 'started',
          label: 'started',
          query: `SELECT MIN(stored) AS value FROM statements`
        },
        {
          key: 'submission timestamp',
          label: 'submission timestamp',
          query: `
            SELECT stored AS value
            FROM statements
            WHERE verb = 'initialized'
              AND object = 'dashboard'`
        },
        {
          key: 'total time spent (seconds)',
          label: 'total time spent (seconds)',
          query: `
            SELECT
              CAST(
                (julianday(MAX(stored)) - julianday(MIN(stored))) * 86400
                AS INTEGER
              ) AS value
            FROM statements`
        }
      ]
    }
  }
}
