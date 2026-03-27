
import { toSqlLiteral } from './sql-utils.js'

export default {
  id: 'rct-chatbot',
  title: 'Chatbot Interactions',
  group: 'RCT Sequence',
  description: 'Chatbot prompt and response history by student interaction.',
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
    const sequenceTopic = state.name || 'Unknown Topic'

    return {
      mode: 'sql-plan',
      rowKeyQuery: `SELECT DISTINCT
        authority AS 'Student ID',
        json_extract(embed_path, '$[0]') AS 'Assignment ID',
        ${toSqlLiteral(params.contextId)} AS 'Sequence ID',
        json_extract(extensions, '$.chatbotEvent.sequenceOrder') AS 'Sequence Order',
        ${toSqlLiteral(sequenceTopic)} AS 'Sequence Topic',
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
      rowKeyColumns: [
        'Student ID',
        'Assignment ID',
        'Sequence ID',
        'Sequence Order',
        'Sequence Topic',
        'Event Timestamp',
        'Item ID',
        'Mode',
        'Item Position at Start',
        'Order of Interaction',
        'Student Query',
        'Student Query Timestamp',
        'Chatbot Response',
        'Chatbot Response Timestamp',
        'LLM Instructions'
      ]
    }
  }
}
