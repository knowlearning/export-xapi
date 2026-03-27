<script setup>
  import { computed, ref, watch } from 'vue'
  import initSQLite from './sqlite.js'
  import downloadCSV from './download-csv.js'
  import ExportControls from './components/ExportControls.vue'
  import ExportResultTable from './components/ExportResultTable.vue'
  import { executeExport, getInitialParams } from './exports/engine.js'
  import { exportDefinitions, getExportDefinition, getExportGroups } from './exports/registry.js'

  const loading = ref(false)
  const loadError = ref(null)
  const environment = await Agent.environment()
  const SQLite = await initSQLite()
  const exportGroups = getExportGroups()
  const selectedExportId = ref(exportDefinitions[0]?.id || '')
  const parameterValues = ref(getInitialParams(exportDefinitions[0]))
  const currentResult = ref(null)

  const selectedDefinition = computed(() => getExportDefinition(selectedExportId.value))
  const canDownload = computed(() => Boolean(currentResult.value))
  const canDownloadRaw = computed(() =>
    Boolean(
      selectedDefinition.value?.supportsRawDownload
      && currentResult.value?.rawData
    )
  )

  watch(selectedExportId, value => {
    parameterValues.value = getInitialParams(getExportDefinition(value))
    currentResult.value = null
    loadError.value = null
  })

  function updateParameter({ key, value }) {
    parameterValues.value = {
      ...parameterValues.value,
      [key]: value
    }
  }

  async function loadExport() {
    loading.value = true
    loadError.value = null
    currentResult.value = null

    try {
      const definition = selectedDefinition.value
      const { result } = await executeExport(definition, {
        rawParams: parameterValues.value,
        environment,
        SQLite
      })

      currentResult.value = result
    } catch (err) {
      loadError.value = err?.message || 'Failed to load data'
    } finally {
      loading.value = false
    }
  }

  function download() {
    if (!currentResult.value) return

    downloadCSV(
      `${selectedExportId.value}-${new Date().toISOString()}.csv`,
      currentResult.value.columns.map(column => column.label),
      currentResult.value.rows.map(row =>
        currentResult.value.columns.map(column => row[column.key] ?? '')
      )
    )
  }

  function downloadRaw() {
    if (!currentResult.value?.rawData) return

    downloadCSV(
      `${selectedExportId.value}-raw-${new Date().toISOString()}.csv`,
      currentResult.value.rawData.columns,
      currentResult.value.rawData.rows
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
      <ExportControls
        :definition="selectedDefinition"
        :export-groups="exportGroups"
        :loading="loading"
        :params="parameterValues"
        :selected-export-id="selectedExportId"
        :show-download="canDownload"
        :show-raw-download="canDownloadRaw"
        @download="download"
        @download-raw="downloadRaw"
        @logout="logout"
        @submit="loadExport"
        @update:param="updateParameter"
        @update:selected-export-id="selectedExportId = $event"
      />
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
        v-else-if="currentResult"
        class="table-container"
        style="display: flex; flex-direction: column; height: 100%;"
      >
        <ExportResultTable :result="currentResult" />
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
