
export default async function constructChatbotInteractions(context) {
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
      json_extract(embed_path, '$[0]') AS 'Assignment ID',
      '${context}' AS 'Sequence ID',
      json_extract(extensions, '$.chatbotEvent.sequenceOrder') AS 'Sequence Order',
     '${sequenceTopic}' AS 'Sequence Topic',
      stored as 'Event Timestamp',
      object as 'Item ID',
      json_extract(extensions, '$.chatbotEvent.phase') AS 'Mode',
      ${itemPositionCase} AS 'Item Position at Start',
      ROW_NUMBER() OVER (
        PARTITION BY authority, json_extract(embed_path, '$[0]')
        ORDER BY json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp')
      ) - 1 AS 'Order of Interaction',
      json_extract(extensions, '$.chatbotEvent.userPrompt.text')  AS 'Student Query',
      json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp') AS 'Student Query Timestamp',
      json_extract(extensions, '$.chatbotEvent.botResponse.text') AS 'Chatbot Response',
      json_extract(extensions, '$.chatbotEvent.botResponse.timestamp') AS 'Chatbot Response Timestamp',
      json_extract(extensions, '$.chatbotEvent.llmInstructions') AS 'LLM Instructions'
    FROM statements
    WHERE json_array_length(embed_path) = 2
      AND json_type(extensions, '$.chatbotEvent') IS NOT NULL;`,
    shardQuery2: null,
    columns: []
  }
}
