<script setup>
  import { ref, reactive } from 'vue'
  import initSQLite from './sqlite.js'
  import QueryCell from './QueryCell.vue'
  import * as columnData from './column-data.js'
  import initStatementsDatabase from './init-statements-database.js'

  const embedPathItem = ref('57c04dc8-f641-49f9-8d3c-88cdfccb402d')
  const shardRows = ref(null)
  const shardDBs = reactive({})
  const tableDescription = reactive(columnData.questionaire)
  const SQLite = await initSQLite()

  async function loadStatements(epItem) {
    shardRows.value = null

    const [db, keys] = await initStatementsDatabase(epItem)

    const stmt = db.prepare(tableDescription.shardQuery)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()

    shardRows.value = rows

    // CONSTRUCT SHARD SPECIFIC DATABASES
    // clear old
    for (const k of Object.keys(shardDBs)) delete shardDBs[k]

    // build each shardDB
    for (const keyColumns of shardRows.value) {
      const shardDb = new SQLite.Database()

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
      const select = db.prepare(tableDescription.shardQuery2)

      const insert = shardDb.prepare(`
        INSERT INTO statements (${keys.join(', ')})
        VALUES (${keys.map(() => '?').join(', ')})
      `)

      //  construct $NAME format params
      const params = (
        Object
          .entries(keyColumns)
          .reduce((a, [k, v]) => {
            a['$'+k] = v
            return a
          }, {})
      )
      select.bind(params)

      while (select.step()) {
        const row = select.get()
        insert.run(row)
      }

      select.free()
      insert.free()

      shardDBs[JSON.stringify(keyColumns)] = shardDb
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
      <div
        class="table-container"
        v-if="shardRows"
      >
        <table>
          <thead>
            <tr>
              <th v-for="_, key in shardRows[0]">{{ key }}</th>
              <th v-for="column, index in tableDescription.columns">
                {{ column.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in shardRows">
              <td v-for="value in d">{{ value }}</td>
              <td v-for="column in tableDescription.columns">
                <QueryCell
                  :database="shardDBs[JSON.stringify(d)]"
                  :rowKey="d"
                  :column="column"
                  :key="column.query"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Suspense>
</template>

<style>
  :root {
    --table-bg: #fff;
    --table-header-bg: #fafafa;
    --table-border: #e5e7eb;
    --table-text: #111827;
    --table-muted: #6b7280;
    --table-row-hover: #eeeeee;
    --table-radius: 8px;
  }

  /* Wrapper for scroll and layout */
  .table-container {
    width: 100%;
    overflow-x: auto;
    box-sizing: border-box;
  }

  /* Base table */
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--table-bg);
    color: var(--table-text);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    font-size: 0.875rem;
    line-height: 1.5;
    border: 1px solid var(--table-border);
    border-radius: var(--table-radius);
  }

  /* Header */
  thead {
    background: var(--table-header-bg);
  }

  th {
    text-align: left;
    padding: 0.75rem 1rem;
    font-weight: 600;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--table-muted);
    border-bottom: 1px solid var(--table-border);
    white-space: nowrap;
  }

  /* Body */
  td {
    padding: 0.8rem 1rem;
    border-bottom: 1px solid var(--table-border);
    vertical-align: middle;
  }

  /* Subtle zebra striping */
  tbody tr:nth-child(even) {
    background: #fcfcfc;
  }

  /* Hover effect */
  tbody tr:hover {
    background: var(--table-row-hover) !important;
    transition: background-color 0.15s ease-in-out;
  }

  /* Numeric columns */
  td.num,
  th.num {
    text-align: right;
  }

  /* Remove bottom border on last row */
  tbody tr:last-child td {
    border-bottom: none;
  }

  /* Clickable rows */
  tbody tr[data-clickable="true"] {
    cursor: pointer;
  }

  /* Compact option (use table.compact if desired) */
  table.compact th,
  table.compact td {
    padding: 0.55rem 0.8rem;
  }

  .column-info {
    padding: 8px;
    background: lightgrey;
    margin-bottom: 16px;
  }

  .column-info textarea,
  .column-info input {
    display: block;
    width: calc(100% - 6px);
    border: none;
  }

  .column-info textarea {
    height: 100px;
    resize: vertical;
  }

</style>