export default {
  id: 'context-summary',
  title: 'Context Summary',
  group: 'Study Info',
  description: 'Basic metadata from Agent.state for the selected context.',
  sourceType: 'direct',
  parameterSchema: [
    {
      key: 'contextId',
      label: 'Context ID',
      type: 'text',
      required: true,
      defaultValue: 'b81b3af0-9af6-11f0-bb3f-f559dff26704'
    }
  ],
  async run({ params, agent }) {
    const state = await agent.state(params.contextId)
    const items = Array.isArray(state?.items) ? state.items : []
    const problemIds = Array.isArray(state?.problemIds) ? state.problemIds : []

    return {
      columns: [
        { key: 'context_id', label: 'Context ID' },
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'item_count', label: 'Item Count' },
        { key: 'problem_count', label: 'Problem Count' }
      ],
      rows: [
        {
          context_id: params.contextId,
          name: state?.name ?? '',
          description: state?.description ?? '',
          item_count: items.length,
          problem_count: problemIds.length
        }
      ]
    }
  }
}
