<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import {
  VISUALIZE_RENDER_LABELS,
  isManimRenderMode,
  type VisualizeFormConfig,
  type VisualizeQuality,
  type VisualizerCatalogItem,
} from '../visualizeConfig'
import {
  importVisualizer,
  installBundledVisualizer,
  listVisualizers,
  setVisualizerEnabled,
  uninstallVisualizer,
} from '../visualizerCatalog'

const props = defineProps<{ modelValue: VisualizeFormConfig }>()
const emit = defineEmits<{ 'update:modelValue': [value: VisualizeFormConfig] }>()

const catalog = ref<VisualizerCatalogItem[]>([])
const catalogError = ref('')
const busy = ref('')
const importInput = ref<HTMLInputElement | null>(null)
const enabledTypes = computed(() => catalog.value.filter(item => item.installed && item.enabled))
const installableTypes = computed(() => catalog.value.filter(item => item.origin === 'bundled' && !item.installed))
const disabledTypes = computed(() => catalog.value.filter(item => item.installed && !item.enabled))
const selected = computed(() => catalog.value.find(item => item.id === props.modelValue.render_mode))
const isManim = computed(() => isManimRenderMode(props.modelValue.render_mode))
const fallbackModes = ['chartjs', 'svg', 'mermaid', 'mindmap', 'html', 'manim_video', 'manim_image']

function update<K extends keyof VisualizeFormConfig>(key: K, value: VisualizeFormConfig[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

async function refreshCatalog() {
  try {
    catalog.value = await listVisualizers()
    catalogError.value = ''
  } catch (cause) {
    catalogError.value = cause instanceof Error ? cause.message : '无法加载可视化器列表'
  }
}

async function mutate(key: string, action: () => Promise<void>) {
  busy.value = key
  catalogError.value = ''
  try {
    await action()
    await refreshCatalog()
  } catch (cause) {
    catalogError.value = cause instanceof Error ? cause.message : '操作失败'
  } finally {
    busy.value = ''
  }
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await mutate('import', () => importVisualizer(file))
}

onMounted(refreshCatalog)
</script>

<template>
  <section class="visualize-config-panel">
    <div class="visualize-config-row">
      <label class="visualize-config-field">
        <span>渲染模式</span>
        <select :value="modelValue.render_mode" @change="update('render_mode', ($event.target as HTMLSelectElement).value)">
          <option value="auto">自动</option>
          <option v-for="item in enabledTypes" :key="item.id" :value="item.id">{{ item.display_name }}</option>
          <template v-if="!enabledTypes.length">
            <option v-for="mode in fallbackModes" :key="mode" :value="mode">{{ VISUALIZE_RENDER_LABELS[mode] || mode }}</option>
          </template>
          <option
            v-if="modelValue.render_mode !== 'auto' && !enabledTypes.some(item => item.id === modelValue.render_mode)"
            :value="modelValue.render_mode"
            disabled
          >{{ modelValue.render_mode }}（不可用）</option>
        </select>
      </label>

      <template v-if="isManim">
        <label class="visualize-config-field visualize-config-quality">
          <span>质量</span>
          <select :value="modelValue.quality" @change="update('quality', ($event.target as HTMLSelectElement).value as VisualizeQuality)">
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </label>
        <label class="visualize-config-field visualize-config-style">
          <span>风格提示</span>
          <input
            :value="modelValue.style_hint"
            placeholder="风格、节奏、颜色…"
            @input="update('style_hint', ($event.target as HTMLInputElement).value)"
          >
        </label>
      </template>
    </div>

    <div class="visualize-config-types">
      <span>可视化器</span>
      <div>
        <button v-for="item in installableTypes" :key="item.id" type="button" :disabled="Boolean(busy)" @click="mutate(`install:${item.id}`, () => installBundledVisualizer(item.id))">
          + {{ item.display_name }}
        </button>
        <button v-for="item in disabledTypes" :key="item.id" type="button" :disabled="Boolean(busy)" @click="mutate(`enable:${item.id}`, () => setVisualizerEnabled(item.id, true))">
          启用 {{ item.display_name }}
        </button>
        <button type="button" class="is-dashed" :disabled="Boolean(busy)" @click="importInput?.click()">导入 .zip</button>
        <input ref="importInput" type="file" accept=".zip,application/zip" hidden @change="importFile">
        <button
          v-if="selected?.installed"
          type="button"
          :disabled="Boolean(busy)"
          @click="update('render_mode', 'auto'); mutate(`disable:${selected.id}`, () => setVisualizerEnabled(selected!.id, false))"
        >停用所选</button>
        <button
          v-if="selected?.installed && selected.uninstallable"
          type="button"
          class="is-danger"
          :disabled="Boolean(busy)"
          @click="update('render_mode', 'auto'); mutate(`remove:${selected.id}`, () => uninstallVisualizer(selected!.id))"
        >卸载所选</button>
        <span v-if="busy" class="visualize-config-busy">正在更新…</span>
      </div>
    </div>
    <p v-if="catalogError" class="visualize-config-error">{{ catalogError }}</p>
  </section>
</template>
