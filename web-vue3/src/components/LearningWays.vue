<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import LegacyIcon from './LegacyIcon.vue'
type Kind = 'books' | 'mastery' | 'practice' | 'reading'
type Surface = { kind: Kind; title: string; href: string; icon: string; tone: string; description: string; intro: string; highlights: string[] }
const surfaces: Surface[] = [
  { kind: 'books', title: '书籍', href: '/learning/books', icon: 'learning', tone: 'amber', description: '生成、浏览并学习你的 AI 编写书籍。', intro: '说出一个主题，DeepTutor 就为你写一本书：先立起章节骨架，再把每一页的正文完整写出来。', highlights: ['正文动笔之前，章节骨架还可以改', '页面里配有插图、时间线、随堂题和记忆卡', '阅读进度会留住，导师也一起读下去'] },
  { kind: 'mastery', title: '精通之路', href: '/learning/mastery', icon: 'resources', tone: 'emerald', description: '沿着持续完善的知识图谱，逐步掌握一个主题。', intro: '说出你想掌握什么。你和导师一起把大纲谈定，它随后变成一张知识点地图，逐个攻克。', highlights: ['开始学习之前，大纲先在对话里谈定', '每个知识点各自记录掌握程度', '复习按各自的节奏到期'] },
  { kind: 'practice', title: '练习', href: '/learning/practice', icon: 'questions', tone: 'sky', description: '管理题库、整理错题，每天巩固所学。', intro: '汇集各个学习场景中的题目，也能导入自己的习题，通过每日练习与复习逐步巩固。', highlights: ['自动收录对话、书籍与精通之路中的题目', '从电子表格导入自己的题目', '按复习计划重温错题'] },
  { kind: 'reading', title: '沉浸式阅读', href: '/learning/reading', icon: 'journal', tone: 'sky', description: '在导师陪伴下，深入阅读你的资料。', intro: '把 PDF、EPUB、网页、视频或音频放进来，就在这里读。选中任意一段就能追问。', highlights: ['文档、网页、视频和音频同在一个资料库里', '回答会指明它出自原文的哪一处', '划线、笔记和生词释义都留在原文旁边'] },
]
const router = useRouter()
const openKind = ref<Kind | null>(null); const panel = ref<HTMLElement | null>(null); let trigger: HTMLElement | null = null
const open = computed(() => surfaces.find(surface => surface.kind === openKind.value) || null)
function show(kind: Kind, event: MouseEvent) { trigger = event.currentTarget as HTMLElement; openKind.value = kind }
function close() { openKind.value = null; void nextTick(() => trigger?.focus()) }
function start() { if (open.value) void router.push(open.value.href) }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); close(); return } if (event.key !== 'Tab' || !panel.value) return; const nodes = [...panel.value.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]; const first = nodes[0]; const last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
watch(open, async value => { if (value) { document.body.style.overflow = 'hidden'; await nextTick(); panel.value?.focus() } else document.body.style.overflow = '' })
onUnmounted(() => { document.body.style.overflow = '' })
</script>
<template>
  <section class="learning-ways-section" aria-label="选择学习方式"><h2 class="legacy-sr-only">选择学习方式</h2><div class="learning-ways-grid"><button v-for="surface in surfaces" :key="surface.kind" type="button" class="learning-way-card" aria-haspopup="dialog" :aria-expanded="openKind === surface.kind" @click="show(surface.kind, $event)"><span class="learning-way-top"><span class="learning-way-icon" :class="`tone-${surface.tone}`"><LegacyIcon :name="surface.icon" :size="21" /></span><span class="learning-way-arrow">↗</span></span><h3>{{ surface.title }}</h3><p>{{ surface.description }}</p></button></div></section>
  <Teleport to="body"><div v-if="open" class="learning-way-overlay"><button class="learning-way-scrim" aria-label="关闭" @click="close" /><section ref="panel" class="learning-way-dialog" role="dialog" aria-modal="true" :aria-label="open.title" tabindex="-1" @keydown="onKeydown"><div class="learning-way-dialog-body"><div class="learning-way-dialog-title"><span class="learning-way-icon" :class="`tone-${open.tone}`"><LegacyIcon :name="open.icon" :size="21" /></span><h3>{{ open.title }}</h3><button aria-label="关闭" @click="close">×</button></div><p class="learning-way-description">{{ open.description }}</p><p class="learning-way-intro">{{ open.intro }}</p><ul><li v-for="highlight in open.highlights" :key="highlight"><span class="learning-way-icon" :class="`tone-${open.tone}`"><LegacyIcon name="questions" :size="12" /></span>{{ highlight }}</li></ul></div><footer><button @click="close">返回</button><button class="primary" @click="start">开始 <span>→</span></button></footer></section></div></Teleport>
</template>
