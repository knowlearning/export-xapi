const names = ['tec1', 'tec2', 'tec2a', 'tec3', 'tec4', 'tec5', 'tec6', 'tec7', 'tec8', 'tec8a', 'tec9', 'tec9a', 'tea1', 'get1', 'grt1', 'tea2', 'tea3']

export const questionaire = {
  context: 'db9a2670-8d78-11f0-a6e9-f58b30f7d3cd',
  shardQuery: `SELECT DISTINCT
  authority AS user,
  json_extract(embed_path, '$[0]') AS assignment
FROM statements
WHERE json_array_length(embed_path) = 3`,
  shardQuery2: `SELECT *
FROM statements
WHERE authority = $user AND json_extract(embed_path, '$[0]') = $assignment`,
  columns: [
    ...names.map(name => ({
      name,
      query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
  AND json_extract(extensions, '$.item.name') = '${name}'
ORDER BY stored DESC LIMIT 1`
    })),
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

export const mathSequence = [
  {
    name: 'Answer 1',
    query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
  AND json_extract(extensions, '$.item.name') = 'seq1'`
  }
]