
export default async function constructSurveyColumnData(context) {
  const sequence = await Agent.state(context)
  const surveyPages = await Promise.all(sequence.items.map(item => Agent.state(item.id)))
  const names = surveyPages.map(s => s.formData.map(d => d.name)).flat()

  return {
    context,
    displayNames: { user: 'user ID', assignment: 'assignment ID', completed: 'submission timestamp' },
    // "shardQuery" is really the "keyQuery" it gets all the defining id/key colums for each row in the data export
    shardQuery: `
      SELECT DISTINCT
        authority AS user,
        json_extract(embed_path, '$[0]') AS assignment
      FROM statements
      WHERE json_array_length(embed_path) = 3`,
    // "shardQuery2" is really the query to gather rows used to fill out other columns for each row from "keyQuery"
    shardQuery2: `
      SELECT *
        FROM statements
        WHERE authority = $user AND json_extract(embed_path, '$[0]') = $assignment`,
    // These are the definitions for the queries over each row's result for "shardQuery2" that defines a column value for each row in "keyQuery"
    columns: [
      ...names.map(name => ({
        name,
        query: `
          SELECT response AS value
            FROM statements
            WHERE verb = 'answered'
              AND json_extract(extensions, '$.item.name') = '${name}'
            ORDER BY stored DESC LIMIT 1`
      })),
      {
        name: 'started',
        query: `SELECT MIN(stored) AS value FROM statements`
      },
      {
        name: 'submission timestamp',
        query: `
          SELECT stored AS value
          FROM statements
          WHERE verb = 'initialized'
            AND object = 'dashboard'`
      },
      {
        name: 'total time spent (seconds)',
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