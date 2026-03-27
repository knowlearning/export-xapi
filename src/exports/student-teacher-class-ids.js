export default {
  id: 'student-teacher-class-ids',
  title: 'Student Teacher Class IDs',
  group: 'Study Info',
  description: 'Raw rows returned by the student-teacher-class-ids query for a given domain.',
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
    const rows = await agent.query('student-teacher-class-ids', [], params.domain)

    return { rows }
  }
}
