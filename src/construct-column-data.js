import { getCorrectAnswerText, getStudentAnswerText } from "./rct-utils";

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
  console.log("State fetched for context ", context, state);
  const problemIds = state.problemIds || [];

  const itemPositionCase = problemIds.length > 0
    ? `CASE object
        ${problemIds.map((id, index) => `WHEN '${id}' THEN ${index}`).join('\n')}
        ELSE NULL
      END`
    : 'NULL';
  const problems = await Promise.all(
    problemIds.map(async id => {
      return {
        id,
        ...(await Agent.state(id))
      }
    })
  );

  const correctAnswers = problems.map(p => getCorrectAnswerText(p));
  const problemKindCase = problems.length > 0 ? `CASE object
    ${problems.map(p => `WHEN '${p.id}' THEN '${p.kind}'`).join('\n')}
    ELSE 'unknown'
  END` : `'unknown'`;

  const correctAnswerCase = problems.length > 0 ? `CASE object
    ${problems.map((p, index) => `WHEN '${p.id}' THEN '${correctAnswers[index].replace(/'/g, "''")}'`).join('\n')}
    ELSE NULL
  END` : 'NULL';

  const sequenceName = state.name || 'Unknown Sequence';
  const sequenceDescription = state.description || '';

  return {
    context,
    shardQuery: `SELECT DISTINCT
      authority AS student_id,
      '${context}' AS sequence_id,
      json_extract(embed_path, '$[0]') AS assignment_id,
      object AS item_id
    FROM statements
    WHERE json_array_length(embed_path) = 2
      AND object IN (${problemIds.map(id => `'${id}'`).join(', ')});`,
    shardQuery2: `SELECT * FROM statements
      WHERE authority = $student_id
        AND json_extract(embed_path, '$[0]') = $assignment_id
        AND object = $item_id`,
    columns: [
      {
        name: 'Sequence Order',
        query: `SELECT json_extract(extensions, '$.sequenceEvent.sequenceOrder') AS value FROM statements LIMIT 1`
      },
      {
        name: 'Sequence Name',
        query: `SELECT '${sequenceName}' AS value`
      },
      {
        name: 'Sequence Concepts',
        query: `SELECT '${sequenceDescription}' AS value`
      },
      {
        name: 'Item Position',
        query: `SELECT ${itemPositionCase} AS value FROM statements LIMIT 1`
      },
      {
        name: 'Item Type',
        query: `SELECT ${problemKindCase} AS value FROM statements LIMIT 1`
      },
      {
        name: 'Date',
        query: `SELECT DATE(stored) AS value FROM statements WHERE verb = 'initialized' ORDER BY stored ASC LIMIT 1`
      },
      {
        name: 'Time stamp',
        query: `SELECT stored AS value FROM statements WHERE verb = 'initialized' ORDER BY stored ASC LIMIT 1`
      },
      {
        name: 'Misconceptions',
        query: `SELECT json_extract(extensions, '$.sequenceEvent.misconception') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored DESC LIMIT 1`
      },
      {
        name: 'Answer 1',
        query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored ASC LIMIT 1`,
        transform: (value, rowContext) => {
          const problem = problems.find(p => p.id === rowContext.item_id);
          return getStudentAnswerText(value, problem);
        }
      },
      {
        name: 'Answer 2',
        query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored ASC LIMIT 1 OFFSET 1`,
        transform: (value, rowContext) => {
          const problem = problems.find(p => p.id === rowContext.item_id);
          return getStudentAnswerText(value, problem);
        }
      },
      {
        name: 'Answer 3',
        query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored ASC LIMIT 1 OFFSET 2`,
        transform: (value, rowContext) => {
          const problem = problems.find(p => p.id === rowContext.item_id);
          return getStudentAnswerText(value, problem);
        }
      },
      {
        name: 'Final answer',
        query: `SELECT json_extract(extensions, '$.runState') AS value FROM statements WHERE verb = 'submitted' ORDER BY stored DESC LIMIT 1`,
        transform: (value, rowContext) => {
          const problem = problems.find(p => p.id === rowContext.item_id);
          return getStudentAnswerText(value, problem);
        }
      },
      {
        name: 'Correct answer',
        query: `SELECT ${correctAnswerCase} AS value FROM statements LIMIT 1`
      },
      {
        name: 'Attempts',
        query: `SELECT COUNT(*) AS value FROM statements WHERE verb = 'submitted'`
      },
      {
        name: 'Item skipped',
        query: `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS value FROM statements WHERE verb = 'skipped'`
      },
      {
        name: 'Item reached',
        query: `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS value FROM statements WHERE verb = 'initialized'`
      },
      {
        name: 'Correct',
        query: `SELECT
                  COALESCE(json_extract(extensions, '$.runState.isCorrect'), 0) AS value
                FROM statements
                WHERE verb = 'submitted'
                ORDER BY stored DESC
                LIMIT 1;`
      },
      {
        name: 'Hands raised',
        query: `SELECT COUNT(*) AS value FROM statements WHERE verb = 'hand_raised'`
      },
      {
        name: 'Time spent on item (exercise) in seconds',
        query: `
            WITH event_groups AS (
              SELECT
                verb,
                stored,
                SUM(CASE WHEN verb = 'initialized' THEN 1 ELSE 0 END)
                OVER (ORDER BY stored ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS group_id
              FROM statements
              WHERE verb IN ('initialized', 'submitted', 'skipped')
            ),
            time_pairs AS (
              SELECT
                group_id,
                MIN(CASE WHEN verb = 'initialized' THEN stored END) AS start_time,
                MAX(CASE WHEN verb IN ('submitted', 'skipped') THEN stored END) AS end_time
              FROM event_groups
              GROUP BY group_id
            )
            SELECT
              CAST(SUM(
                (julianday(end_time) - julianday(start_time)) * 86400
              ) AS INTEGER) AS value
            FROM time_pairs
            WHERE start_time IS NOT NULL AND end_time IS NOT NULL
          `
      },
      {
        name: 'Time spent on item (review) in seconds',
        query: `SELECT CAST((julianday(MAX(CASE WHEN json_extract(extensions, '$.sequenceEvent.phase')='review' THEN stored END)) - julianday(MIN(CASE WHEN json_extract(extensions, '$.sequenceEvent.phase')='review' THEN stored END))) * 86400 AS INTEGER) AS value FROM statements`
      },
      {
        name: '# of messages sent (student)',
        query: `SELECT COUNT(*) AS value FROM statements WHERE json_type(extensions, '$.chatbotEvent.userPrompt') IS NOT NULL`
      },
      {
        name: '# of messages sent (chatbot)',
        query: `SELECT COUNT(*) AS value FROM statements WHERE json_type(extensions, '$.chatbotEvent.botResponse') IS NOT NULL`
      },
      {
        name: 'Student initiated chat',
        query: `SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS value FROM statements WHERE json_type(extensions, '$.chatbotEvent.userPrompt') IS NOT NULL`
      },
      {
        name: 'timestamp of first interaction with chatbot',
        query: `SELECT json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp') AS value FROM statements WHERE json_type(extensions, '$.chatbotEvent.userPrompt') IS NOT NULL ORDER BY stored ASC LIMIT 1`
      }
    ]
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
      json_extract(extensions, '$.chatbotEvent.userPrompt.text')  AS 'User Query',
      json_extract(extensions, '$.chatbotEvent.userPrompt.timestamp') AS 'User Query Timestamp',
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