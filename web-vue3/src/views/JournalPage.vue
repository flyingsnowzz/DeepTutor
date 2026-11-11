<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Journal {
  mission: { topic: string; why: string; level: string; updated_at: string }
  last_session: { summary: string; next_focus: string; updated_at: string }
  records: { id: string; title: string; insight: string; created_at: string }[]
}
const journal = ref<Journal | null>(null)
const loading = ref(true)
const error = ref('')
const journalMenuOpen = ref(false)
let controller: AbortController | undefined

async function load() {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const result = await api<Journal>('/api/learning-journal', { signal: controller.signal })
    if (!controller.signal.aborted) journal.value = result
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '学习日志加载失败，原始数据已保留，请刷新重试。'
    }
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <main class="feature-page journal-page">
    <nav class="journal-page-bar" aria-label="位置"><button type="button" class="journal-refresh" :disabled="loading" @click="load">刷新</button><div class="journal-crumb-wrap journal-crumb-leading"><button type="button" class="journal-crumb" aria-haspopup="menu" :aria-expanded="journalMenuOpen" @click.stop="journalMenuOpen = !journalMenuOpen" @keydown.esc="journalMenuOpen = false"><span aria-hidden="true"><LegacyIcon name="journal" :size="14" /></span>学习日志</button><template v-if="journalMenuOpen"><div class="journal-menu-dismiss" @click="journalMenuOpen = false"></div><div class="journal-resource-menu" role="menu" aria-label="资料"><p>资料</p><RouterLink role="menuitem" to="/space" @click="journalMenuOpen = false">全部资料</RouterLink><RouterLink role="menuitem" to="/space/chat-history" @click="journalMenuOpen = false">聊天历史</RouterLink><RouterLink role="menuitem" to="/notebooks" @click="journalMenuOpen = false">收藏夹</RouterLink><RouterLink role="menuitem" class="is-active" to="/space/journal" @click="journalMenuOpen = false">学习日志</RouterLink><RouterLink role="menuitem" to="/space/questions" @click="journalMenuOpen = false">题库</RouterLink><RouterLink role="menuitem" to="/knowledge-bases" @click="journalMenuOpen = false">知识中心</RouterLink></div></template></div></nav>
    <div class="journal-page-content"><RouterLink to="/space" class="text-button">← 空间</RouterLink>
    <header class="feature-heading">
      <div><h1>学习日志</h1><p>导师的当前目标、会话交接和已确认的学习记录。</p></div>
      <button type="button" :disabled="loading" @click="load">刷新</button>
    </header>
    <div v-if="error" class="journal-error-card" role="alert"><p class="error">{{ error }}</p></div>
    <p v-if="loading" role="status">加载中…</p>
    <template v-if="journal">
      <section class="reading-create" aria-label="当前学习目标">
        <h2>当前学习目标</h2>
        <template v-if="journal.mission.topic">
          <strong>{{ journal.mission.topic }}</strong>
          <p v-if="journal.mission.why">{{ journal.mission.why }}</p>
          <p v-if="journal.mission.level">等级：{{ journal.mission.level }}</p>
          <time v-if="journal.mission.updated_at" :datetime="journal.mission.updated_at">{{ journal.mission.updated_at }}</time>
        </template>
        <p v-else>导师尚未记录你的学习目标。在对话中请导师设置一个目标。</p>
      </section>
      <section class="reading-create" aria-label="上次会话交接">
        <h2>上次会话交接</h2>
        <template v-if="journal.last_session.summary || journal.last_session.next_focus">
          <p v-if="journal.last_session.summary">{{ journal.last_session.summary }}</p>
          <p v-if="journal.last_session.next_focus"><strong>下一步：</strong>{{ journal.last_session.next_focus }}</p>
          <time v-if="journal.last_session.updated_at" :datetime="journal.last_session.updated_at">{{ journal.last_session.updated_at }}</time>
        </template>
        <p v-else>暂无会话交接。</p>
      </section>
      <section class="reading-create" aria-label="已确认的学习记录">
        <h2>已确认的学习记录</h2>
        <ol v-if="journal.records.length">
          <li v-for="record in journal.records" :key="record.id">
            <h3>{{ record.title }}</h3><p>{{ record.insight }}</p>
            <time v-if="record.created_at" :datetime="record.created_at">{{ record.created_at }}</time>
          </li>
        </ol>
        <p v-else>暂无已确认的学习记录。</p>
      </section>
    </template>
    </div>
  </main>
</template>
