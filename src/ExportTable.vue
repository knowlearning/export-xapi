<script setup>
  import { ref, reactive } from 'vue'
  import initSQLite from './sqlite.js'
  import constructColumnData from './construct-column-data.js'
  import initStatementsDatabase from './init-statements-database.js'
  import downloadCSV from './download-csv.js'

  const embedPathItem = ref('f8d047f0-8d8d-11f0-ba51-f9f87536173e')
  const shardRows = ref(null)
  const shardDBs = reactive({})
  const environment = await Agent.environment()
  const fullDb = ref(null)
  const SQLite = await initSQLite()
  const tableKeys = ref(null)
  const tableData = ref(null)

  async function loadStatements(epItem) {
    shardRows.value = null

    const tableDescription = await constructColumnData(epItem)
    const db = await initStatementsDatabase(epItem)
    fullDb.value = db

    const stmt = db.prepare(tableDescription.shardQuery)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()

    shardRows.value = rows

    // CONSTRUCT SHARD SPECIFIC DATABASES
    // clear old
    for (const k of Object.keys(shardDBs)) delete shardDBs[k]

    const primaryKeys = Object.keys(shardRows.value[0])
    const otherKeys = tableDescription.columns.map(c => c.name)

    tableKeys.value = [ ...primaryKeys, ...otherKeys ]
    tableData.value = []

    // build each shardDB
    for (const keyColumns of shardRows.value) {
      const shardDb = new SQLite.Database()
      const select = db.prepare(tableDescription.shardQuery2)

      //  construct $NAME format params
      select
        .bind(
          Object
            .entries(keyColumns)
            .reduce((a, [k, v]) => (a[`$${k}`]=v, a), {})
        )

      const keys = select.getColumnNames()

      // create the shard table schema
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

      const insert = shardDb.prepare(`
        INSERT INTO statements
          (${keys.join(', ')})
        VALUES
          (${keys.map(() => '?').join(', ')})
      `)

      while (select.step()) insert.run(select.get())

      select.free()
      insert.free()

      shardDBs[JSON.stringify(keyColumns)] = shardDb

      // construct table data
      const shardRow = [...Object.values(keyColumns)]
      for (const column of tableDescription.columns) {
        const statement = shardDb.prepare(column.query)
        const values = []
        try {
          while (statement.step()) {
            values.push(statement.getAsObject())
          }
        }
        finally {
          statement.free()
        }

        //  TODO: should probably be an error value for the cell if does not conform to this output
        shardRow.push(values?.[0]?.value)
      }
      tableData.value.push(shardRow)
    }
  }

  function download() {
    downloadCSV(
      `${embedPathItem.value}-${new Date().toISOString()}.csv`,
      tableKeys.value,
      tableData.value
    )
  }

  function downloadRaw(sqliteDB) {
    if (!sqliteDB) return

    const stmt = sqliteDB.prepare('SELECT * FROM statements')
    const headers = stmt.getColumnNames()
    const rows = []

    try {
      while (stmt.step()) {
        const row = stmt.get().map(v =>
          v == null ? '' : String(v)
        )
        rows.push(row)
      }
    } finally {
      stmt.free()
    }

    downloadCSV(
      `${embedPathItem.value}-raw-${new Date().toISOString()}.csv`,
      headers,
      rows
    )
  }

  function login() {
    Agent.login()
  }

  function logout() {
    Agent.logout()
  }

</script>

<template>
  <Suspense>
    <div v-if="environment.auth.provider === 'anonymous'">
      <v-btn @click="login">Login</v-btn>
    </div>
    <div
      v-else
      style="
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
      "
    >
      <div>
        <v-text-field
          v-model="embedPathItem"
          label="Survey Sequence Id"
          placeholder="embed path filter"
          density="compact"
          hide-details
          @keypress.enter="loadStatements(embedPathItem)"
        >
          <template #prepend-inner>
            <v-btn
              @click="logout"
              text="logout"
            />
            <v-btn
              v-if="shardRows"
              @click="download"
            >
              download
            </v-btn>
            <v-btn
              v-if="shardRows"
              @click="downloadRaw(fullDb)"
            >
              Download Raw xAPI
            </v-btn>
          </template>
          <template #append-inner>
            <v-btn
              color="primary"
              @click="loadStatements(embedPathItem)"
            >
              load
            </v-btn>
          </template>
        </v-text-field>
      </div>
      <div
        class="table-container"
        v-if="shardRows"
        style="display: flex; flex-direction: column; height: 100%;"
      >
        <v-data-table
          :headers="tableKeys.map(key => ({ key, title: key }))"
          :items="tableData.map((row, i) => {
            return row.reduce((acc, curr, i) => {
              acc[tableKeys[i]] = curr
              return acc
            }, {})
          })"
          fixed-header
          virtual-scroll
          hide-default-footer
          :items-per-page="-1"
          style="flex: 1; overflow-y: auto;"
        />
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
    flex-grow: 1;
    overflow: hidden;
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