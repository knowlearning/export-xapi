export async function constructSurveyColumnData(context) {
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

export async function constructStudentSequenceData(context) {
  const state = await Agent.state(context);
  const problemIds = state.problemIds || [];
  const problems = await Promise.all(
    problemIds.map(async id => {
      return {
        id,
        ...(await Agent.state(id))
      }
    })
  );
  const problemKindCase = problems.length > 0 ? `CASE object
    ${problems.map(p => `WHEN '${p.id}' THEN '${p.kind}'`).join('\n')}
    ELSE 'unknown'
  END` : `'unknown'`;

  return {
    context,
    shardQuery: `SELECT DISTINCT
      authority AS 'Student ID',
      json_extract(embed_path, '$[0]') AS 'Assignment ID'
      json_extract(embed_path, '$[0]') AS 'Sequence ID',
      json_extract(extensions, '$.sequenceEvent.sequenceOrder') AS 'Sequence Order',
      object AS 'Problem ID',
      ${problemKindCase} AS 'Problem Kind'
    FROM statements
    WHERE json_array_length(embed_path) = 2
      AND object IN (${problemIds.map(id => `'${id}'`).join(', ')});`,
    shardQuery2: null,
    columns: []
  }
}

export async function constructChatbotInteractions(context) {
  const state = await Agent.state(context);
  const problemIds = state.problemIds || [];
  const itemPositionCase = problemIds.length > 0
    ? `CASE object
        ${problemIds.map((id, index) => `WHEN '${id}' THEN ${index}`).join('\n')}
        ELSE NULL
      END`
    : 'NULL';

  const sequenceTopic = state.name || 'Unknown Topic';

  
  return {
    context,
    shardQuery: `SELECT DISTINCT
      authority AS 'Student ID',
      json_extract(embed_path, '$[0]') AS 'Sequence ID',
      json_extract(extensions, '$.chatbotEvent.sequenceOrder') AS 'Sequence Order',
     ' ${sequenceTopic}' AS 'Sequence Topic',
      stored as 'Event Timestamp',
      object as 'Item ID',
      json_extract(extensions, '$.chatbotEvent.phase') AS 'Mode',
      ${itemPositionCase} AS 'Item Position at Start',
      ROW_NUMBER() OVER (
        PARTITION BY authority, json_extract(embed_path, '$[0]')
        ORDER BY json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp')
      ) - 1 AS 'Order of Interaction',
      json_extract(extensions, '$.chatbotEvent.userPrompt.text')  AS 'User Query(original)',
      json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp') AS 'User Query Timestamp',
      json_extract(extensions, '$.chatbotEvent.botResponse.text') AS 'Chatbot Response(original)',
      json_extract(extensions, '$.chatbotEvent.botResponse.timestamp') AS 'Chatbot Response Timestamp',
      json_extract(extensions, '$.chatbotEvent.llmInstructions') AS 'LLM Instructions'
    FROM statements
    WHERE json_array_length(embed_path) = 2
      AND json_type(extensions, '$.chatbotEvent') IS NOT NULL;`,
    shardQuery2: null,
    columns: []
  }
}