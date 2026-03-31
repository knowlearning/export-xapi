<script setup>
  import { computed, nextTick, ref } from 'vue'

  const props = defineProps({
    definition: {
      type: Object,
      default: null
    },
    exportGroups: {
      type: Array,
      required: true
    },
    params: {
      type: Object,
      required: true
    },
    rememberedTextOptions: {
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
    'commit:param',
    'download',
    'downloadRaw',
    'logout',
    'remove:remembered-param-option',
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
  const comboboxMenus = ref({})
  const suppressNextComboboxOpen = ref({})

  function updateParameter(parameter, value) {
    emit('update:param', { parameter, value })
  }

  function commitParameter(parameter, value) {
    emit('commit:param', { parameter, value })
  }

  function updateAndCommitParameter(parameter, value) {
    updateParameter(parameter, value)
    commitParameter(parameter, value)
  }

  function submitWithParameter(parameter) {
    suppressComboboxOpenOnce(parameter.key)
    closeCombobox(parameter.key)
    commitParameter(parameter, props.params[parameter.key])
    emit('submit')
  }

  function removeRememberedOption(key, value) {
    emit('remove:remembered-param-option', { key, value })
  }

  function updateComboboxMenu(key, value) {
    if (value && suppressNextComboboxOpen.value[key]) {
      suppressNextComboboxOpen.value = {
        ...suppressNextComboboxOpen.value,
        [key]: false
      }
      closeCombobox(key)
      return
    }

    comboboxMenus.value = {
      ...comboboxMenus.value,
      [key]: value
    }
  }

  function closeCombobox(key) {
    updateComboboxMenu(key, false)
  }

  function suppressComboboxOpenOnce(key) {
    suppressNextComboboxOpen.value = {
      ...suppressNextComboboxOpen.value,
      [key]: true
    }

    nextTick(() => {
      suppressNextComboboxOpen.value = {
        ...suppressNextComboboxOpen.value,
        [key]: false
      }
    })
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
          @update:model-value="updateAndCommitParameter(parameter, $event)"
        />

        <v-combobox
          v-else-if="parameter.type === 'text'"
          :items="rememberedTextOptions[parameter.key] || []"
          :label="parameter.label"
          :menu="comboboxMenus[parameter.key] ?? false"
          :model-value="params[parameter.key]"
          :placeholder="parameter.helpText"
          density="compact"
          hide-details
          style="min-width: 220px;"
          @blur="commitParameter(parameter, params[parameter.key])"
          @keydown.enter.prevent="submitWithParameter(parameter)"
          @update:menu="updateComboboxMenu(parameter.key, $event)"
          @update:model-value="updateParameter(parameter, $event)"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps">
              <template #append>
                <v-list-item-action end>
                  <span
                    class="remembered-remove"
                    title="Remove remembered entry"
                    @mousedown.stop.prevent
                    @click.stop="removeRememberedOption(parameter.key, item.raw ?? item.title)"
                  >
                    <v-icon
                      icon="$close"
                      size="x-small"
                    />
                  </span>
                </v-list-item-action>
              </template>
            </v-list-item>
          </template>
        </v-combobox>

        <v-text-field
          v-else
          :label="parameter.label"
          :model-value="params[parameter.key]"
          :placeholder="parameter.helpText"
          :type="getInputType(parameter)"
          density="compact"
          hide-details
          style="min-width: 220px;"
          @blur="commitParameter(parameter, params[parameter.key])"
          @keydown.enter.prevent="submitWithParameter(parameter)"
          @update:model-value="updateParameter(parameter, $event)"
        />
      </template>
    </div>

    <div
      v-if="showDownload || showRawDownload"
      class="controls-row controls-row-downloads"
    >
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

  .controls-row-downloads {
    justify-content: flex-start;
  }

  .remembered-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.72;
  }

  .remembered-remove:hover {
    opacity: 1;
  }
</style>
