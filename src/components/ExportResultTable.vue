<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    result: {
      type: Object,
      default: null
    }
  })

  const headers = computed(() =>
    (props.result?.columns || []).map(column => ({
      key: column.key,
      title: column.label
    }))
  )

  const items = computed(() => props.result?.rows || [])
</script>

<template>
  <div class="table-container">
    <div
      v-if="result && result.rows.length === 0"
      class="empty-state"
    >
      No rows matched this export.
    </div>

    <v-data-table
      v-else-if="result"
      :headers="headers"
      :items="items"
      fixed-header
      virtual-scroll
      hide-default-footer
      :items-per-page="-1"
      style="flex: 1; overflow-y: auto;"
    />
  </div>
</template>

<style scoped>
  .table-container {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--table-muted);
    font-size: 1rem;
  }
</style>
