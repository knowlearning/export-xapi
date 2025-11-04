<script setup>
  import { ref } from 'vue'
  import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
  import initSqlJs from 'sql.js'

  const embedPathItem = ref(null)
  const data = ref(null)
  const tableData = ref(null)

  const SQL = await initSqlJs({
    locateFile: () => wasmUrl
  })

  async function loadStatements(epItem) {
    data.value = null
    tableData.value = null

    data.value = await Agent.query('statements-in-context', [epItem], 'xapi.knowlearning.systems')

    if (data.length === 0) return

    const db = new SQL.Database()

    const keys = Object.keys(data.value[0])

    db.run(`
      CREATE TABLE statements (
        id TEXT PRIMARY KEY,
        ${
          keys
            .filter(name => name !== 'id')
            .map(name => `${name} TEXT`)
            .join(',\n')
        }
      );
    `)

    const insert = db.prepare(`
      INSERT
        INTO statements (${keys.join(', ')})
        VALUES (${keys.map(k => '?').join(', ')})
    `)

    for (const p of data.value) {
      insert.run(
        Object.values(p).map(v => {
          if (v === null || v === undefined) return null
          if (typeof v === 'object') return JSON.stringify(v)
          if (typeof v === 'boolean') return v ? '1' : '0'
          return String(v)
        })
      )
    }

    insert.free()

    const result = db.exec(`
      SELECT DISTINCT authority
      FROM statements
    `)
    tableData.value = result[0]?.values.map(([authority]) => ({
      authority
    })) || []
  }

</script>

<template>
  <Suspense>
    <div>
      <input
        v-model="embedPathItem"
        placeholder="embed path filter"
      />
      <button @click="loadStatements(embedPathItem)">load</button>
      <table
        v-if="tableData"
      >
        <thead>
          <tr>
            <th>user</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in tableData">
            <td>{{ d.authority }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </Suspense>
</template>