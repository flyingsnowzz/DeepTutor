<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

type Mark = 'idle' | 'running' | 'unread' | 'failed'
const titles = ['DeepTutor 模型配置工作台', 'DeepTutor 侧边栏聊天历史重组', 'Thinking-orbs 集成到 DeepTutor', 'DeepTutor 模型配置集成逻辑', 'deeptutor.info 文档审查', 'New session']
const cycle: Mark[] = ['idle', 'running', 'unread', 'idle', 'running', 'failed']
const phase = ref(0)
const auto = ref(true)
const size = ref(12)
const marks = computed(() => titles.map((_, index) => cycle[(phase.value + index) % cycle.length]))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { if (auto.value) phase.value++ }, 1800) })
onUnmounted(() => { if (timer) clearInterval(timer) })
function color(mark: Mark) { return mark === 'failed' ? '#e3a129' : mark === 'unread' ? '#2563eb' : '#84928b' }
</script>

<template>
  <main class="feature-page avatar-preview-page">
    <h1>会话头像状态</h1>
    <p class="muted">预览会话运行、未读、失败和空闲时的侧边栏标记。列表会自动演示状态变化。</p>
    <div class="avatar-preview-controls">
      <button @click="auto = !auto">{{ auto ? '暂停' : '播放' }}</button>
      <button @click="phase++">下一步</button>
      <span>尺寸</span>
      <button v-for="option in [11, 12, 13, 14]" :key="option" :aria-pressed="size === option" @click="size = option">{{ option }}px</button>
    </div>
    <div class="avatar-preview-layout">
      <section><h2>侧边栏原尺寸</h2><div class="avatar-preview-list"><div v-for="(title, index) in titles" :key="title" class="avatar-preview-row"><span class="avatar-mark" :style="{ width: `${size}px`, height: `${size}px` }"><span v-if="marks[index] === 'running'" class="avatar-orb" :style="{ width: `${size}px`, height: `${size}px` }" /><svg v-else viewBox="0 0 12 12" :width="size" :height="size" aria-hidden="true"><circle cx="6" cy="6" r="5.1" :stroke="color(marks[index])" stroke-width="1.25" :fill="marks[index] === 'idle' ? 'transparent' : color(marks[index])" /></svg></span><span class="avatar-preview-title">{{ title }}</span></div></div></section>
      <section><h2>状态快照 · 4 倍放大</h2><div class="avatar-preview-snapshots"><div v-for="mark in (['running', 'unread', 'failed', 'idle'] as Mark[])" :key="mark"><span class="avatar-preview-zoom"><span v-if="mark === 'running'" class="avatar-orb" :style="{ width: `${size}px`, height: `${size}px` }" /><svg v-else viewBox="0 0 12 12" :width="size" :height="size" aria-hidden="true"><circle cx="6" cy="6" r="5.1" :stroke="color(mark)" stroke-width="1.25" :fill="mark === 'idle' ? 'transparent' : color(mark)" /></svg></span><small>{{ { running: '运行中', unread: '未读', failed: '失败', idle: '空闲' }[mark] }}</small></div></div></section>
    </div>
  </main>
</template>
