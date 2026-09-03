// Mirrors the study configuration in pila-project/pila-platform.
export const TEACHER_TAG_ID = '49bf66a0-ed49-11ee-be89-5b04faf266ea'
export const TREATMENT_TAG_ID = '472a84d0-ab69-11f0-b8c9-a1d0807d9f84'
export const CONTROL_TAG_ID = '41ad5640-ab69-11f0-b8c9-a1d0807d9f84'

export const DOMAIN_TO_PARTITION = Object.freeze({
  'f74e9cb3-2b53-4c85-9b0c-f1d61b032b3f.localhost:9898': 'PILA Dev',
  'app.pilaproject.org': 'PILA',
  'cambodia.pilaproject.org': 'PILA Cambodia',
  'thailand.pilaproject.org': 'PILA Thailand',
  'dev.gforcesolution.com': 'PILA Thailand Development',
  'pila.gforcesolution.com': 'PILA Thailand Development',
  'polska-rct-2025.pilaproject.org': 'PILA Poland RCT 2025',
  'france-rct-2025.pilaproject.org': 'PILA France RCT 2025',
  'testing.pilaproject.org': 'PILA Testing',
  'ui-dev.pilaproject.org': 'PILA UI Development',
  'deutschland-rct-2026.pilaproject.org': 'PILA Germany RCT 2026',
  'nederland-rct-2026.pilaproject.org': 'PILA Netherlands RCT 2026',
  'latvija-rct-2026.pilaproject.org': 'PILA Latvia RCT 2026',
  'slovensko-rct-2026.pilaproject.org': 'PILA Slovakia RCT 2026'
})

export const TEACHER_TREATMENT_CONTROL_COLUMNS = Object.freeze([
  { key: 'teacher', label: 'teacher' },
  { key: 'treatment', label: 'treatment' },
  { key: 'control', label: 'control' },
  { key: 'added_to_teacher', label: 'added to teacher' },
  { key: 'added_to_treatment', label: 'added to treatment' },
  { key: 'added_to_control', label: 'added to control' }
])

const TAGS_DOMAIN = 'tags.knowlearning.systems'

function partitionForDomain(domain) {
  const normalizedDomain = String(domain).trim().toLowerCase()
  const partition = DOMAIN_TO_PARTITION[normalizedDomain]

  if (!partition) {
    throw new Error(`No tag partition configured for domain "${domain}"`)
  }

  return partition
}

function createTeacherRow(teacher) {
  return {
    teacher,
    treatment: false,
    control: false,
    added_to_teacher: '',
    added_to_treatment: '',
    added_to_control: ''
  }
}

function mergeTaggings(teacherTaggings, treatmentTaggings, controlTaggings) {
  const rowsByTeacher = new Map()

  function rowFor(tagging) {
    if (!tagging?.target) return null

    if (!rowsByTeacher.has(tagging.target)) {
      rowsByTeacher.set(tagging.target, createTeacherRow(tagging.target))
    }

    return rowsByTeacher.get(tagging.target)
  }

  for (const tagging of teacherTaggings) {
    const row = rowFor(tagging)
    if (!row) continue

    row.added_to_teacher = tagging.timestamp ?? ''
  }

  for (const tagging of treatmentTaggings) {
    const row = rowFor(tagging)
    if (!row) continue

    row.treatment = true
    row.added_to_treatment = tagging.timestamp ?? ''
  }

  for (const tagging of controlTaggings) {
    const row = rowFor(tagging)
    if (!row) continue

    row.control = true
    row.added_to_control = tagging.timestamp ?? ''
  }

  return [...rowsByTeacher.values()]
    .sort((left, right) => left.teacher.localeCompare(right.teacher))
}

export default {
  id: 'teacher-treatment-control',
  title: 'Teacher Treatment and Control Groups',
  group: 'Study Info',
  description: 'Teacher treatment and control group membership for a PILA domain.',
  sourceType: 'direct',
  parameterSchema: [
    {
      key: 'domain',
      label: 'Domain',
      type: 'text',
      required: true
    }
  ],
  async run({ params, agent }) {
    const partition = partitionForDomain(params.domain)
    const [teacherTaggings, treatmentTaggings, controlTaggings] = await Promise.all([
      agent.query('taggings-for-tag', [partition, TEACHER_TAG_ID], TAGS_DOMAIN),
      agent.query('taggings-for-tag', [partition, TREATMENT_TAG_ID], TAGS_DOMAIN),
      agent.query('taggings-for-tag', [partition, CONTROL_TAG_ID], TAGS_DOMAIN)
    ])

    return {
      columns: TEACHER_TREATMENT_CONTROL_COLUMNS,
      rows: mergeTaggings(teacherTaggings, treatmentTaggings, controlTaggings)
    }
  }
}
