<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import { displayPreset, type SettingsPreset } from '../settingsPresets'

interface PresetsResponse {
  schema_version: string
  presets: SettingsPreset[]
}

const props = defineProps<{ enabled?: boolean }>()
const emit = defineEmits<{ staged: [presetId: string] }>()

const presets = ref<SettingsPreset[] | null>(null)
const loading = ref(false)
const error = ref('')
const activeId = ref<string | null>(null)
const displayPresets = computed(() => (presets.value ?? []).map(displayPreset))

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const payload = await api<PresetsResponse>('/api/settings/presets')
    presets.value = payload.presets
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法加载配置预设。'
  } finally {
    loading.value = false
  }
}

async function loadDraft(preset: SettingsPreset) {
  if (activeId.value) return
  activeId.value = preset.id
  try {
    // Stage into the existing draft envelope; backend merges without touching live settings.
    await api(`/api/settings/presets/${encodeURIComponent(preset.id)}/draft`, {
      method: 'POST',
      body: JSON.stringify({ extensions: {} }),
    })
    emit('staged', preset.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载预设草稿失败。'
  } finally {
    activeId.value = null
  }
}

onMounted(() => {
  if (props.enabled !== false) void refresh()
})
</script>

<template>
  <section class="settings-presets">
    <header class="settings-presets-header">
      <div>
        <h2>配置起点</h2>
        <p>将预设加载为草稿；只有应用后才会更改设置。</p>
      </div>
      <button type="button" class="settings-presets-refresh" :disabled="loading" @click="refresh">
        <LegacyIcon name="history" :size="13" />
        刷新
      </button>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="presets && presets.length === 0" class="muted">当前没有可用预设。</p>

    <div v-if="loading && !presets" class="settings-presets-grid">
      <div v-for="i in 4" :key="i" class="settings-preset-card settings-preset-skeleton" />
    </div>

    <div v-else-if="displayPresets.length" class="settings-presets-grid">
      <article v-for="preset in displayPresets" :key="preset.id" class="settings-preset-card">
        <div class="settings-preset-head">
          <h3>{{ preset.name }}</h3>
          <span class="settings-preset-cost">{{ preset.costText }}</span>
        </div>
        <p class="settings-preset-desc">{{ preset.descriptionText }}</p>
        <dl class="settings-preset-meta">
          <div><dt>解析引擎</dt><dd><code>{{ preset.parser }}</code></dd></div>
          <div v-if="preset.prerequisiteText"><dt>前置条件</dt><dd>{{ preset.prerequisiteText }}</dd></div>
          <div v-if="preset.credentialText"><dt>所需凭据</dt><dd>{{ preset.credentialText }}</dd></div>
          <div v-if="preset.featureText"><dt>解锁能力</dt><dd>{{ preset.featureText }}</dd></div>
        </dl>
        <button
          type="button"
          class="settings-preset-load"
          :disabled="activeId === preset.id || enabled === false"
          @click="loadDraft(preset)"
        >
          <LegacyIcon v-if="activeId === preset.id" name="activity" :size="13" />
          加载草稿
        </button>
      </article>
    </div>
  </section>
</template>
