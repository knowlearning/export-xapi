export default async function constructColumnData(context) {
  const sequence = await Agent.state(context)
  const surveyPages = await Promise.all(sequence.items.map(item => Agent.state(item.id)))
  const names = surveyPages.map(s => s.formData.map(d => d.name)).flat()

  return {
    context,
    // "shardQuery" is really the "keyQuery" it gets all the defining id/key colums for each row in the data export
    shardQuery: `SELECT DISTINCT
    authority AS user,
    json_extract(embed_path, '$[0]') AS assignment
  FROM statements
  WHERE json_array_length(embed_path) = 3`,
    // "shardQuery2" is really the query to gather rows used to fill out other columns for each row from "keyQuery"
    shardQuery2: `SELECT *
  FROM statements
  WHERE authority = $user AND json_extract(embed_path, '$[0]') = $assignment`,
    // These are the definitions for the queries over each row's result for "shardQuery2" that defines a column value for each row in "keyQuery"
    columns: [
      ...names.map(name => ({
        name,
        query: `SELECT response AS value
  FROM statements
  WHERE verb = 'answered'
    AND json_extract(extensions, '$.item.name') = '${name}'
  ORDER BY stored DESC LIMIT 1`
      })),
      {
        name: 'completed',
        query: `SELECT stored AS value
  FROM statements
  WHERE verb = 'initialized'
    AND object = 'dashboard'`
      },
      {
        name: 'total time spent (seconds)',
        query: `SELECT
  CAST(
    (julianday(MAX(stored)) - julianday(MIN(stored))) * 86400
    AS INTEGER
  ) AS value
  FROM statements`
      }
    ]
  }
}


  //     {
  //       name: 'all responses',
  //       query: `SELECT
  //   json_group_object(item_name, response) AS value
  // FROM (
  //   SELECT
  //     json_extract(extensions, '$.item.name') AS item_name,
  //     response
  //   FROM statements AS s1
  //   WHERE verb = 'answered'
  //     AND item_name IS NOT NULL
  //     AND stored = (
  //       SELECT MAX(s2.stored)
  //       FROM statements AS s2
  //       WHERE json_extract(s2.extensions, '$.item.name') = json_extract(s1.extensions, '$.item.name')
  //         AND s2.verb = 'answered'
  //     )
  // )`
  //     },