<script setup>
  import { ref, reactive } from 'vue'
  import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
  import initSqlJs from 'sql.js'
  import QueryCell from './QueryCell.vue'

  const embedPathItem = ref('57c04dc8-f641-49f9-8d3c-88cdfccb402d')
  const database = ref(null)
  const data = ref(null)
  const tableData = ref(null)
  const authorityDatabases = reactive({})
  const columns = reactive([
    {
      query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
AND json_extract(extensions, '$.item.name') = 'seq1'`
    },
    { query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
AND json_extract(extensions, '$.item.name') = 'seq2'
    ` },
    { query: `SELECT response AS value
FROM statements
WHERE verb = 'answered'
AND json_extract(extensions, '$.item.name') = 'seq3'
    ` },
    { query: `SELECT stored AS value
FROM statements
WHERE verb = 'initialized'
AND object = 'dashboard'`
    }
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


    // CONSTRUCT AUTHORITY SPECIFIC SHARDS
    // clear any old shard DBs
    for (const k of Object.keys(authorityDatabases)) {
      delete authorityDatabases[k]
    }

    // build a shard DB per authority
    for (const { authority } of tableData.value) {
      console.log('CREATING AUTHORITY DB', authority)
      const shardDb = new SQL.Database()

      // recreate the statements table schema
      shardDb.run(`
        CREATE TABLE statements (
          id TEXT PRIMARY KEY,
          ${
            keys
              .filter(name => name !== 'id')
              .map(name => `${name} TEXT`)
              .join(',\n')
          }
        )
      `)

      // pull rows for this authority from the main DB
      const select = db.prepare(`
        SELECT ${keys.join(', ')}
        FROM statements
        WHERE authority = ?
      `)

      const insert = shardDb.prepare(`
        INSERT INTO statements (${keys.join(', ')})
        VALUES (${keys.map(() => '?').join(', ')})
      `)

      select.bind([authority])
      while (select.step()) {
        const row = select.get()
        insert.run(row)
      }

      select.free()
      insert.free()

      authorityDatabases[authority] = shardDb
    }
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
                :database="authorityDatabases[d.authority]"
                :authority="d.authority"
                :column="column"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Suspense>
</template>