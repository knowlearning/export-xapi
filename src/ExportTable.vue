<script setup>
  import { ref, reactive } from 'vue'
  import initSQLite from './sqlite.js'
  import {constructChatbotInteractions, constructSurveyColumnData, constructStudentSequenceData } from './construct-column-data.js'
  import initStatementsDatabase from './init-statements-database.js'
  import downloadCSV from './download-csv.js'

  const embedPathItem = ref('b81b3af0-9af6-11f0-bb3f-f559dff26704')
  const shardRows = ref(null)
  const loading = ref(false)
  const loadError = ref(null)
  const shardDBs = reactive({})
  const environment = await Agent.environment()
  const fullDb = ref(null)
  const SQLite = await initSQLite()
  const tableKeys = ref(null)
  const tableDisplayKeys = ref(null)
  const tableData = ref(null)

  const exportTypes = [
    {
      topic: 'RCT Sequence',
      items: [
        {
          title: 'Student Sequence Data',
          value: 'rct-student-sequence-data',
          handler: constructStudentSequenceData,
        },
        {
          title: 'Chatbot Interactions',
          value: 'rct-chatbot',
          handler: constructChatbotInteractions
        },
      ]
    },
    {
      topic: 'Survey Data',
      items: [
        {
          title: 'Survey Responses',
          value: 'survey-responses',
          handler: constructSurveyColumnData
        }
      ]
    }
  ]

  const selectedExportType = ref('rct-student-sequence-data')

  async function loadStatements(epItem) {
    epItem = epItem?.trim()
    embedPathItem.value = epItem
    loading.value = true
    loadError.value = null
    shardRows.value = null
    try {

    // Find the selected export handler
    const selectedHandler = exportTypes
      .flatMap(group => group.items)
      .find(item => item.value === selectedExportType.value)?.handler || constructChatbotInteractions

    const tableDescription = await selectedHandler(epItem)
    const db = await initStatementsDatabase(epItem)
    fullDb.value = db

    const stmt = db.prepare(tableDescription.shardQuery)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()

    shardRows.value = rows

    const useSharding = tableDescription.shardQuery2 && tableDescription.columns?.length > 0;

    if (!useSharding) {
      const firstRow = shardRows.value[0]
      if (firstRow) {
        tableKeys.value = Object.keys(firstRow)
        tableDisplayKeys.value = tableKeys.value
        tableData.value = shardRows.value.map(r => Object.values(r))
      }
      return
    }

    // CONSTRUCT SHARD SPECIFIC DATABASES
    // clear old
    for (const k of Object.keys(shardDBs)) delete shardDBs[k]

    const primaryKeys = Object.keys(shardRows.value[0])
    const otherKeys = tableDescription.columns.map(c => c.name)

    tableKeys.value = [ ...primaryKeys, ...otherKeys ]
    const displayNames = tableDescription.displayNames || {}
    const primaryDisplayKeys = primaryKeys.map(k => displayNames[k] ?? k)
    tableDisplayKeys.value = [ ...primaryDisplayKeys, ...otherKeys ]
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

        let cellValue = values?.[0]?.value

        // Apply transform function if it exists
        if (column.transform && cellValue != null) {
          try {
            cellValue = column.transform(cellValue, keyColumns)
          } catch (error) {
            console.error(`Transform failed for column "${column.name}":`, error)
            cellValue = `[Error: ${error.message}]`
          }
        }

        shardRow.push(cellValue)
      }
      tableData.value.push(shardRow)
    }

    } catch (err) {
      loadError.value = err?.message || 'Failed to load data'
    } finally {
      loading.value = false
    }
  }

  function download() {
    downloadCSV(
      `${embedPathItem.value}-${new Date().toISOString()}.csv`,
      tableDisplayKeys.value,
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
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn
                  v-bind="props"
                  variant="outlined"
                  density="compact"
                  style="margin-left: 12px;"
                >
                  {{ exportTypes.flatMap(g => g.items).find(i => i.value === selectedExportType)?.title || 'Select Export Type' }} ▼
                </v-btn>
              </template>
              <v-list>
                <template v-for="group in exportTypes" :key="group.topic">
                  <v-list-subheader>{{ group.topic }}</v-list-subheader>
                  <v-list-item
                    v-for="item in group.items"
                    :key="item.value"
                    :value="item.value"
                    @click="selectedExportType = item.value"
                  >
                    <v-list-item-title>{{ item.title }}</v-list-item-title>
                  </v-list-item>
                </template>
              </v-list>
            </v-menu>
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
      <!-- Loading state -->
      <div v-if="loading" style="display:flex; flex-direction:column; align-items:center; justify-content:center; flex:1; gap:16px;">
        <v-progress-circular indeterminate color="primary" size="64" />
        <span style="color: var(--table-muted); font-size: 1rem;">Loading data...</span>
      </div>

      <!-- Error state -->
      <v-alert
        v-else-if="loadError"
        type="error"
        variant="tonal"
        style="margin: 16px;"
        :text="loadError"
      />

      <!-- Table state -->
      <div
        v-else-if="shardRows"
        class="table-container"
        style="display: flex; flex-direction: column; height: 100%;"
      >
        <v-data-table
          :headers="tableKeys.map((key, i) => ({ key, title: tableDisplayKeys[i] }))"
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