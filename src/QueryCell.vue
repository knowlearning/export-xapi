<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    database: Object,
    column: Object
  })

  const x = computed(() => {
    const db = props.database
    const sql = props.column.query

    if (!db || !sql) return null

    const stmt = db.prepare(sql)
    const rows = []

    try {
      while (stmt.step()) {
        rows.push(stmt.getAsObject())
      }
    } finally {
      stmt.free()
    }

    return rows
  })
</script>

<template>
  <span>{{ x?.[0]?.value }}</span>
</template>
