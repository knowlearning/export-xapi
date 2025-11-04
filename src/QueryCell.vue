<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    database: Object,
    query: String,
    authority: String
  })

  const x = computed(() => {
    const db = props.database
    const sql = props.query

    console.log(sql)

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
  <pre>{{ x }}</pre>
</template>
