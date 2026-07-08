
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

    const problems = await Promise.all(
      problemIds.map(async id => ({
        id,
        ...(await agent.state(id))
      }))
    );

    const itemCannonicalIds = problems.map(problem => problem.canonicalId || problem.cannonicalId).filter(Boolean);
    const itemCannonicalIdCase = itemCannonicalIds.length > 0
      ? `CASE object
          ${problems.map(problem => `WHEN '${problem.id}' THEN ${toSqlLiteral(problem.canonicalId)}`).join('\n')}
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
        ${toSqlLiteral(sequenceTopic)} AS 'Sequence Topic',
        stored as 'Event Timestamp',
        object as 'Item ID',
        ${itemCannonicalIdCase} AS 'Item Canonical ID',
        json_extract(extensions, '$.chatbotEvent.phase') AS 'Mode',
        ${itemPositionCase} AS 'Item Position at Start',
        CASE
          WHEN json_extract(extensions, '$.chatbotEvent.conversationStarterSelection') IS NOT NULL THEN 'Conversation Starter Selection'
          ELSE 'Chatbot Prompt'
        END AS 'Event Type',
        json_extract(extensions, '$.chatbotEvent.conversationStarterSelection.kind') AS 'Starter Kind',
        json_extract(extensions, '$.chatbotEvent.conversationStarterSelection.timestamp') AS 'Starter Timestamp',
        ROW_NUMBER() OVER (
          PARTITION BY authority, json_extract(embed_path, '$[0]'), object
          ORDER BY stored
        ) - 1 AS 'Order of Interaction',
        json_extract(extensions, '$.chatbotEvent.userPrompt.text') AS 'Student Query',
        json_extract(extensions, '$.chatbotEvent.userPrompt.meta') AS 'Student Query Meta',
        json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp') AS 'Student Query Timestamp',
        json_extract(extensions, '$.chatbotEvent.botResponse.text') AS 'Chatbot Response',
        json_extract(extensions, '$.chatbotEvent.botResponse.timestamp') AS 'Chatbot Response Timestamp',
        json_extract(extensions, '$.chatbotEvent.botResponse.meta') AS 'LLM Instructions Meta',
        json_extract(extensions, '$.chatbotEvent.accuracyState') AS 'Accuracy State',
        CASE WHEN json_extract(extensions, '$.chatbotEvent.pii') = true THEN 1 ELSE 0 END AS 'PII'
      FROM statements
      WHERE json_array_length(embed_path) = 2
        AND json_type(extensions, '$.chatbotEvent') IS NOT NULL
        AND (
          json_extract(extensions, '$.chatbotEvent.userPrompt.text') IS NOT NULL
          OR json_extract(extensions, '$.chatbotEvent.conversationStarterSelection') IS NOT NULL
        )
      ORDER BY json_extract(embed_path, '$[0]'), authority, ${itemPositionCase}, stored;`,
      rowKeyColumns: [
        'Student ID',
        'Assignment ID',
        'Sequence ID',
        'Sequence Topic',
        'Event Timestamp',
        'Item ID',
        'Item Canonical ID',
        'Mode',
        'Item Position at Start',
        'Event Type',
        'Starter Kind',
        'Starter Timestamp',
        'Order of Interaction',
        'Student Query',
        'Student Query Meta',
        'Student Query Timestamp',
        'Chatbot Response',
        'Chatbot Response Timestamp',
        'LLM Instructions Meta',
        'Accuracy State',
        'PII',
      ]
    }
  }
}
