<script setup lang="ts">
import LegacyIcon from './LegacyIcon.vue'
interface Version { version?: string; signature?: string; state?: string; model?: string; dimension?: number; created_at?: string; ready?: boolean; legacy?: boolean; failure_summary?: string }
const props = defineProps<{ versions: Version[]; readOnly?: boolean; busy?: boolean }>()
const emit = defineEmits<{ reindex: [] }>()
function label(version: Version) { return version.version || version.signature || '未命名版本' }
function time(value?: string) { return value ? new Date(value).toLocaleString('zh-CN') : '时间未知' }
</script>
<template><section class="kb-section"><header class="kb-section-heading"><div><h2>索引版本</h2><p>查看每次索引生成的模型、维度、状态与创建时间。</p></div><button v-if="!readOnly" class="primary" :disabled="busy" @click="emit('reindex')"><LegacyIcon name="history" :size="14" />重新建立索引</button></header><div v-if="!props.versions.length" class="kb-empty">尚无索引版本。</div><div v-else class="kb-record-list"><article v-for="(version, index) in props.versions" :key="version.signature || version.version || index"><div><strong>{{ label(version) }}</strong><p>{{ version.state || (version.ready ? '可用' : '未发布') }}<template v-if="version.model"> · {{ version.model }}</template><template v-if="version.dimension"> · {{ version.dimension }}d</template></p><small>{{ time(version.created_at) }}</small><p v-if="version.failure_summary" class="error">{{ version.failure_summary }}</p></div><span v-if="version.ready" class="kb-ready">✓ 当前版本</span></article></div></section></template>
