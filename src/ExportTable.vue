<script setup>
  import { ref, reactive } from 'vue'
  import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
  import initSqlJs from 'sql.js'
  import QueryCell from './QueryCell.vue'

  const embedPathItem = ref('57c04dc8-f641-49f9-8d3c-88cdfccb402d')
  const database = ref(null)
  const data = ref(null)
  const tableData = ref(null)
  const columns = reactive([
    { query: `SELECT stored
FROM statements
WHERE verb = 'initialized'
AND object = 'dashboard'`
    },
    { query: `` }
  ])

  const SQL = await initSqlJs({
    locateFile: () => wasmUrl
  })

  async function loadStatements(epItem) {
    data.value = null
    tableData.value = null

    data.value = await Agent.query('statements-in-context', [epItem], 'xapi.knowlearning.systems')

    if (data.length === 0) return

    const db = new SQL.Database()
    database.value = db

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

    tableData.value = db.exec(`
      SELECT DISTINCT authority
      FROM statements
    `)[0]?.values.map(([authority]) => ({ authority })) || []
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
            <th v-for="_, index in columns">
              <textarea
                :key="index"
                v-model="columns[index].query"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in tableData">
            <td>{{ d.authority }}</td>
            <td v-for="column in columns">
              <QueryCell
                :database="database"
                :authority="d.authority"
                :query="column.query"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Suspense>
</template>