export const questionaire = {
  shardQuery: `SELECT DISTINCT
  authority AS user,
  json_extract(embed_path, '$[0]') AS assignment
FROM statements`,
  columns: [
    {
      name: 'seq1',
      query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
  AND json_extract(extensions, '$.item.name') = 'seq1'`
    },
    {
      name: 'seq2',
      query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
  AND json_extract(extensions, '$.item.name') = 'seq2'
    ` },
    {
      name: 'seq3',
      query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
  AND json_extract(extensions, '$.item.name') = 'seq3'
    ` },
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