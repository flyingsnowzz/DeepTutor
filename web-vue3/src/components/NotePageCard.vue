<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
interface Note { id: string; title: string; preview: string; updated_at: number; parent_id: string | null; pinned: boolean; revision: number; icon: string; cover?: string }
const props = withDefaults(defineProps<{ page: Note; parentTitle?: string; childCount?: number; dateLabel: string; busy?: boolean }>(), { parentTitle: '', childCount: 0, busy: false })
const emit = defineEmits<{ pin: []; delete: [] }>()
const open = ref(false)
const confirming = ref(false)
const root = ref<HTMLElement | null>(null)
function setOpen(value: boolean) { open.value = value; if (!value) confirming.value = false }
function outside(event: MouseEvent) { if (root.value && !root.value.contains(event.target as Node)) setOpen(false) }
onMounted(() => document.addEventListener('mousedown', outside)); onUnmounted(() => document.removeEventListener('mousedown', outside))
const title = props.page.title || '未命名页面'
</script>
<template><article ref="root" class="dt-notes-card" :class="{ 'has-cover': page.cover, 'is-menu-open': open }"><RouterLink :to="`/co-writer/${page.id}`" class="dt-notes-card-link" :aria-label="title"><div v-if="page.cover" class="dt-notes-card-cover" :style="{ background: page.cover }" /><div class="dt-notes-card-body"><span class="dt-notes-card-icon" aria-hidden="true">{{ page.icon || '▤' }}</span><h3>{{ title }}</h3><p :class="{ 'is-empty': !page.preview }">{{ page.preview || '空白页面' }}</p><footer><LegacyIcon v-if="page.pinned" name="bookmark" :size="11" /><template v-if="parentTitle"><span class="truncate">{{ parentTitle }}</span><span>·</span></template><span>{{ dateLabel }}</span><template v-if="childCount"><span>·</span><span>{{ childCount }} 个子页面</span></template></footer></div></RouterLink><div class="dt-notes-card-menu"><button class="dt-note-icon-button" :aria-label="`页面操作：${title}`" aria-haspopup="menu" :aria-expanded="open" :disabled="busy" @click="setOpen(!open)"><LegacyIcon name="more" :size="16" /></button><div v-if="open" class="dt-popover dt-notes-card-popover" role="menu"><button role="menuitem" class="dt-menu-item" @click="setOpen(false); emit('pin')"><LegacyIcon :name="page.pinned ? 'close' : 'bookmark'" :size="14" />{{ page.pinned ? '取消置顶' : '置顶到顶部' }}</button><div class="dt-menu-divider" /><template v-if="confirming"><p class="dt-notes-confirm">{{ childCount ? '删除此页面？其子页面将上移一级。' : '删除此页面？此操作无法撤销。' }}</p><button role="menuitem" class="dt-menu-item is-danger" @click="setOpen(false); emit('delete')"><LegacyIcon name="close" :size="14" />删除页面</button></template><button v-else role="menuitem" class="dt-menu-item is-danger" @click="confirming = true"><LegacyIcon name="close" :size="14" />删除</button></div></div></article></template>
