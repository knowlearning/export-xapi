
import { toSqlLiteral } from './sql-utils.js'

function getFormDataNames(page) {
  return Array.isArray(page?.formData)
    ? page.formData.map(field => field?.name).filter(Boolean)
    : []
}

function collectSchemaElementNames(elements = [], names = []) {
  for (const element of elements || []) {
    if (
      element?.name
      && !['expression', 'html', 'image', 'panel'].includes(element.type)
    ) {
      names.push(element.name)
    }

    collectSchemaElementNames(element?.elements, names)
    collectSchemaElementNames(element?.templateElements, names)
  }

  return names
}

function getSchemaNames(page) {
  const schema = page?.schema || page
  const pageElements = Array.isArray(schema?.pages)
    ? schema.pages.flatMap(surveyPage => surveyPage?.elements || [])
    : []
  const rootElements = Array.isArray(schema?.elements) ? schema.elements : []

  return collectSchemaElementNames([...pageElements, ...rootElements])
}

function getPageQuestionNames(page) {
  const formDataNames = getFormDataNames(page)

  return formDataNames.length > 0 ? formDataNames : getSchemaNames(page)
}

async function getSurveyExportContext(params, agent) {
  const context = await agent.state(params.contextId)

  if (Array.isArray(context?.items)) {
    const pages = await Promise.all(context.items.map(item => agent.state(item.id)))

    return {
      mode: 'sequence',
      pages,
      usesLegacyFormData: pages.some(page => getFormDataNames(page).length > 0)
    }
  }

  return {
    mode: 'direct',
    pages: [context],
    usesLegacyFormData: getFormDataNames(context).length > 0
  }
}

function getNames(pages) {
  return pages.flatMap(getPageQuestionNames)
}

function getRowKeyQuery(mode, contextId) {
  if (mode === 'sequence') {
    return `
        SELECT DISTINCT
          authority AS user,
          json_extract(embed_path, '$[0]') AS assignment
        FROM statements
        WHERE json_array_length(embed_path) = 3`
  }

  return `
        SELECT DISTINCT
          authority AS user,
          COALESCE(json_extract(embed_path, '$[0]'), source, ${toSqlLiteral(contextId)}) AS assignment
        FROM statements`
}

function getRowScopeQuery(mode, contextId) {
  if (mode === 'sequence') {
    return `
        SELECT *
          FROM statements
          WHERE authority = $user AND json_extract(embed_path, '$[0]') = $assignment`
  }

  return `
        SELECT *
          FROM statements
          WHERE authority = $user
            AND COALESCE(json_extract(embed_path, '$[0]'), source, ${toSqlLiteral(contextId)}) = $assignment`
}

function getSubmissionTimestampQuery(usesLegacyFormData) {
  if (usesLegacyFormData) {
    return `
            SELECT stored AS value
            FROM statements
            WHERE verb = 'initialized'
              AND object = 'dashboard'`
  }

  return `
            SELECT stored AS value
            FROM statements
            WHERE verb = 'completed'
            ORDER BY stored DESC LIMIT 1`
}

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
    const surveyContext = await getSurveyExportContext(params, agent)
    const names = getNames(surveyContext.pages)

    return {
      mode: 'sql-plan',
      displayNames: { user: 'user ID', assignment: 'assignment ID', completed: 'submission timestamp' },
      rowKeyColumns: ['user', 'assignment'],
      rowKeyQuery: getRowKeyQuery(surveyContext.mode, params.contextId),
      rowScopeQuery: getRowScopeQuery(surveyContext.mode, params.contextId),
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
          query: getSubmissionTimestampQuery(surveyContext.usesLegacyFormData)
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
