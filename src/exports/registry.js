import rctSequenceExport from './rct-sequence.js'
import rctChatbotExport from './rct-chatbot.js'
import surveySequenceExport from './survey-sequence.js'
import sequenceSummaryExport from './sequence-summary.js'
import studentTeacherClassIdsExport from './student-teacher-class-ids.js'
import teacherDashboardUsageExport from './teacher-dashboard-usage.js'

export const exportDefinitions = [
  rctSequenceExport,
  rctChatbotExport,
  surveySequenceExport,
  sequenceSummaryExport,
  studentTeacherClassIdsExport,
  teacherDashboardUsageExport
]

export function getExportDefinition(exportId) {
  return exportDefinitions.find(definition => definition.id === exportId)
}

export function getExportGroups() {
  return exportDefinitions.reduce((groups, definition) => {
    const existingGroup = groups.find(group => group.title === definition.group)

    if (existingGroup) {
      existingGroup.items.push(definition)
      return groups
    }

    groups.push({
      title: definition.group,
      items: [definition]
    })

    return groups
  }, [])
}
