<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    definition: {
      type: Object,
      default: null
    },
    exportGroups: {
      type: Array,
      required: true
    },
    loading: {
      type: Boolean,
      default: false
    },
    params: {
      type: Object,
      required: true
    },
    selectedExportId: {
      type: String,
      required: true
    },
    showDownload: {
      type: Boolean,
      default: false
    },
    showRawDownload: {
      type: Boolean,
      default: false
    }
  })

  const emit = defineEmits([
    'download',
    'downloadRaw',
    'logout',
    'submit',
    'update:param',
    'update:selectedExportId'
  ])

  const exportOptions = computed(() =>
    props.exportGroups.flatMap(group =>
      group.items.map(item => ({
        title: `${group.title} / ${item.title}`,
        value: item.id
      }))
    )
  )

  function updateParameter(key, value) {
    emit('update:param', { key, value })
  }

  function getInputType(parameter) {
    if (parameter.type === 'date') return 'date'
    if (parameter.type === 'datetime') return 'datetime-local'
    if (parameter.type === 'number') return 'number'
    return 'text'
  }
</script>

<template>
  <div class="controls">
    <div class="controls-row controls-row-actions">
      <v-btn
        @click="emit('logout')"
        text="logout"
      />
      <v-btn
        v-if="showDownload"
        @click="emit('download')"
      >
        download
      </v-btn>
      <v-btn
        v-if="showRawDownload"
        @click="emit('downloadRaw')"
      >
        Download Raw Data
      </v-btn>
    </div>

    <div class="controls-row controls-row-fields">
      <v-select
        :items="exportOptions"
        :model-value="selectedExportId"
        label="Export"
        density="compact"
        hide-details
        style="min-width: 260px; max-width: 340px;"
        @update:model-value="emit('update:selectedExportId', $event)"
      />

      <template v-for="parameter in definition?.parameterSchema || []" :key="parameter.key">
        <v-select
          v-if="parameter.type === 'select'"
          :items="parameter.options || []"
          item-title="label"
          item-value="value"
          :label="parameter.label"
          :model-value="params[parameter.key]"
          density="compact"
          hide-details
          style="min-width: 220px;"
          @update:model-value="updateParameter(parameter.key, $event)"
        />

        <v-text-field
          v-else
          :label="parameter.label"
          :model-value="params[parameter.key]"
          :placeholder="parameter.helpText"
          :type="getInputType(parameter)"
          density="compact"
          hide-details
          style="min-width: 220px;"
          @keypress.enter="emit('submit')"
          @update:model-value="updateParameter(parameter.key, $event)"
        />
      </template>

      <v-btn
        color="primary"
        :loading="loading"
        @click="emit('submit')"
      >
        load
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-bottom: 1px solid var(--table-border);
  }

  .controls-row {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .controls-row-actions {
    justify-content: flex-end;
  }
</style>
