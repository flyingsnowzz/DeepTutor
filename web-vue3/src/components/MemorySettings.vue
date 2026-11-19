<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { api } from '../api'
import NumberSettingRow from './NumberSettingRow.vue'
import ToggleSettingRow from './ToggleSettingRow.vue'

type Settings = {
  update: { l2_budget: number; l3_budget: number }
  audit: { l2_budget: number; l3_budget: number }
  dedup: { iterations: number; auto_after_update: boolean }
  merge: { auto_after_update: boolean; auto_after_audit: boolean; auto_after_dedup: boolean }
  chunking: { overlap_ratio: number; boundary: 'paragraph' | 'sentence'; min_chunk_chars: number; max_chunk_chars: number }
  reference: { enforce_required: boolean; drop_invalid_refs: boolean }
}
const props = withDefaults(defineProps<{ pending?: unknown; revision?: number; language?: string }>(), { revision: 0 })
const emit = defineEmits<{ change: [value: Settings]; loaded: [value: Settings] }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const settings = reactive<Settings>({
  update: { l2_budget: 4, l3_budget: 4 }, audit: { l2_budget: 4, l3_budget: 4 },
  dedup: { iterations: 3, auto_after_update: false },
  merge: { auto_after_update: false, auto_after_audit: false, auto_after_dedup: false },
  chunking: { overlap_ratio: 0.1, boundary: 'paragraph', min_chunk_chars: 1200, max_chunk_chars: 4000 },
  reference: { enforce_required: true, drop_invalid_refs: true },
})
const loading = ref(true)
const loaded = ref(false)
const error = ref('')
let loadVersion = 0
async function load() {
  const version = ++loadVersion
  loading.value = true
  loaded.value = false
  error.value = ''
  try {
    const live = await api<Settings>('/api/memory/settings')
    if (version !== loadVersion) return
    Object.assign(settings, (props.pending as Settings | undefined) ?? live)
    loaded.value = true
    emit('loaded', live)
  } catch (cause) {
    if (version === loadVersion) error.value = cause instanceof Error ? cause.message : tr('设置加载失败', 'Failed to load settings')
  } finally {
    if (version === loadVersion) loading.value = false
  }
}
onMounted(load)
onUnmounted(() => { loadVersion++ })
watch(() => props.revision, load)
function changed() { if (loaded.value) emit('change', JSON.parse(JSON.stringify(settings))) }
function patch<K extends keyof Settings>(key: K, value: Partial<Settings[K]>) {
  if (!loaded.value) return
  Object.assign(settings[key], value)
  changed()
}
</script>

<template>
  <div data-tour="tour-memory">
    <header class="legacy-settings-page-header"><h1>{{ tr('记忆', 'Memory') }}</h1><p>{{ tr('调整分块整理器：Update / Audit / Dedup 的 LLM 轮次、分块强度，以及引用校验的严格程度。', 'Tune the chunk-based consolidator: how many LLM rounds per Update / Audit / Dedup, how aggressively to chunk, and how strictly to validate references.') }}</p></header>
    <p v-if="loading" class="legacy-settings-loading">{{ tr('加载中…', 'Loading...') }}</p>
    <p v-else-if="error" class="error" role="alert">{{ tr('设置加载失败。', 'Failed to load settings.') }} {{ error }}</p>
    <template v-else-if="loaded">
      <section class="legacy-setting-section"><header><h2>{{ tr('Update 模式', 'Update mode') }}</h2><p>{{ tr('分块增量事实提取的默认 LLM 轮次；单文档覆盖在工作台中设置。', 'Default LLM rounds for chunk-based incremental fact extraction. Per-doc overrides live in the workbench.') }}</p></header><div class="legacy-setting-section-body">
        <NumberSettingRow :title="tr('L2 预算（每个 surface）', 'L2 budget (per surface)')" :description="tr('一次 L2 update 最多生成的分块数。', 'Maximum chunks the chunker emits for an L2 update.')" :value="settings.update.l2_budget" :min="1" :max="200" @change="patch('update', { l2_budget: $event })" />
        <NumberSettingRow :title="tr('L3 预算（每个 slot）', 'L3 budget (per slot)')" :description="tr('一次 L3 update 跨 7 份 L2 文档的最大分块数。', 'Maximum chunks for an L3 update across the 7 L2 docs.')" :value="settings.update.l3_budget" :min="1" :max="200" @change="patch('update', { l3_budget: $event })" />
      </div></section>
      <section class="legacy-setting-section"><header><h2>{{ tr('Audit 模式', 'Audit mode') }}</h2><p>{{ tr('根据原始证据逐行编辑的默认 LLM 轮次。', 'Default LLM rounds for line-level edits against raw evidence.') }}</p></header><div class="legacy-setting-section-body">
        <NumberSettingRow :title="tr('L2 预算（每个 surface）', 'L2 budget (per surface)')" :value="settings.audit.l2_budget" :min="1" :max="200" @change="patch('audit', { l2_budget: $event })" />
        <NumberSettingRow :title="tr('L3 预算（每个 slot）', 'L3 budget (per slot)')" :value="settings.audit.l3_budget" :min="1" :max="200" @change="patch('audit', { l3_budget: $event })" />
      </div></section>
      <section class="legacy-setting-section"><header><h2>Dedup</h2><p>{{ tr('对完整文档进行迭代去重；某轮没有编辑时提前停止。', 'Iterative dedup over the full doc. Stops early when an iteration emits zero edits.') }}</p></header><div class="legacy-setting-section-body">
        <NumberSettingRow :title="tr('迭代次数', 'Iterations')" :value="settings.dedup.iterations" :min="1" :max="20" @change="patch('dedup', { iterations: $event })" />
        <ToggleSettingRow :title="tr('Update 后自动运行 Dedup', 'Run dedup automatically after Update')" :checked="settings.dedup.auto_after_update" @change="patch('dedup', { auto_after_update: $event })" />
      </div></section>
      <section class="legacy-setting-section"><header><h2>{{ tr('合并脚注', 'Merge footnotes') }}</h2><p>{{ tr('不使用 LLM：合并重复引用行并重新编号，可安全重复执行。', 'No-LLM consolidation: collapse duplicate ref rows into one footnote each, then renumber. Idempotent, safe to run any time.') }}</p></header><div class="legacy-setting-section-body">
        <ToggleSettingRow :title="tr('Update 后自动合并', 'Merge automatically after Update')" :checked="settings.merge.auto_after_update" @change="patch('merge', { auto_after_update: $event })" />
        <ToggleSettingRow :title="tr('Audit 后自动合并', 'Merge automatically after Audit')" :checked="settings.merge.auto_after_audit" @change="patch('merge', { auto_after_audit: $event })" />
        <ToggleSettingRow :title="tr('Dedup 后自动合并', 'Merge automatically after Dedup')" :checked="settings.merge.auto_after_dedup" @change="patch('merge', { auto_after_dedup: $event })" />
      </div></section>
      <section class="legacy-setting-section"><header><h2>{{ tr('分块', 'Chunking') }}</h2><p>{{ tr('控制内容拆分方式的底层选项。', 'Lower-level knobs that shape how content is split.') }}</p></header><div class="legacy-setting-section-body">
        <NumberSettingRow :title="tr('重叠比例', 'Overlap ratio')" :description="tr('下一块携带上一块内容的比例，范围 0–0.5。', 'Fraction of chunk size carried into the next chunk. 0–0.5.')" :value="settings.chunking.overlap_ratio" :min="0" :max="0.5" :step="0.05" float @change="patch('chunking', { overlap_ratio: $event })" />
        <div class="legacy-setting-row"><div><h3>{{ tr('边界', 'Boundary') }}</h3><p>{{ tr('分块器优先切分的位置。', 'Where the chunker prefers to cut.') }}</p></div><select v-model="settings.chunking.boundary" :aria-label="tr('边界', 'Boundary')" @change="changed"><option value="paragraph">{{ tr('段落', 'Paragraph') }}</option><option value="sentence">{{ tr('句子', 'Sentence') }}</option></select></div>
        <NumberSettingRow :title="tr('最小分块字符数', 'Min chunk chars')" :description="tr('单个分块的下限。', 'Floor for individual chunk size.')" :value="settings.chunking.min_chunk_chars" :min="200" :max="64000" :step="100" @change="patch('chunking', { min_chunk_chars: $event })" />
        <NumberSettingRow :title="tr('最大分块字符数', 'Max chunk chars')" :description="tr('单个分块的上限。', 'Ceiling for individual chunk size.')" :value="settings.chunking.max_chunk_chars" :min="200" :max="64000" :step="100" @change="patch('chunking', { max_chunk_chars: $event })" />
      </div></section>
      <section class="legacy-setting-section"><header><h2>{{ tr('引用', 'References') }}</h2><p>{{ tr('事实必须如何引用其提取来源分块。', 'How strictly facts must cite the chunk they were extracted from.') }}</p></header><div class="legacy-setting-section-body">
        <ToggleSettingRow :title="tr('每条事实都必须带引用', 'Require ref on every fact')" :description="tr('丢弃未返回引用的事实。', 'Drops facts that come back without a ref.')" :checked="settings.reference.enforce_required" @change="patch('reference', { enforce_required: $event })" />
        <ToggleSettingRow :title="tr('丢弃无效引用（而不是整条事实）', 'Drop invalid refs (vs reject the whole fact)')" :description="tr('开启时保留事实，仅移除来源池外的引用；关闭时，任何无效引用都会拒绝事实。', 'On: keep the fact, drop only out-of-pool refs. Off: any bad ref rejects the fact.')" :checked="settings.reference.drop_invalid_refs" @change="patch('reference', { drop_invalid_refs: $event })" />
      </div></section>
    </template>
  </div>
</template>
