<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../api'

const profile = reactive<Record<string, any>>({})
const error = ref('')
const notice = ref('')
const busy = ref(false)
const fields = [
  ['age', '年龄'], ['grade_level', '年级'], ['curriculum', '课程体系'],
  ['language', '首选语言'], ['reading_level', '阅读水平'], ['explanation_style', '讲解方式'],
]
onMounted(async () => { try { Object.assign(profile, (await api<{ learner_profile?: Record<string, any> | null }>('/api/auth/profile/learner-profile')).learner_profile || {}) } catch (cause) { error.value = cause instanceof Error ? cause.message : '档案加载失败' } })
async function save() {
  busy.value = true
  error.value = ''
  notice.value = ''
  const payload = Object.fromEntries(
    Object.entries(profile).filter(([, value]) => value !== '' && value !== null && value !== undefined),
  )
  try {
    await api('/api/auth/profile/learner-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    notice.value = '学习者档案已保存'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败'
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <section><h2>学习者档案</h2><p>用于调整讲解方式和阅读支持。</p><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><form class="profile-fields" @submit.prevent="save"><label v-for="[key, label] in fields" :key="key">{{ label }}<input v-model="profile[key]" :type="key === 'age' ? 'number' : 'text'" :min="key === 'age' ? 3 : undefined" :max="key === 'age' ? 120 : undefined"></label><button class="primary" :disabled="busy">保存档案</button></form></section>
</template>
