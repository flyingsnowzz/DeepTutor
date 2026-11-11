<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../api'

type Profile = { age?: number; grade_level?: string; curriculum?: string; language?: string; reading_level?: string; explanation_style?: string }
const props = defineProps<{ username: string }>()
const profile = ref<Profile>({})
const loading = ref(false)
const saving = ref(false)
const feedback = ref('')
const fields = [
  { key: 'grade_level', label: '年级' },
  { key: 'curriculum', label: '课程体系' },
  { key: 'language', label: '偏好语言' },
  { key: 'reading_level', label: '阅读水平' },
  { key: 'explanation_style', label: '讲解风格' },
] as const

async function load() {
  loading.value = true
  feedback.value = ''
  try {
    const result = await api<{ learner_profile: Profile | null }>(`/api/auth/users/${encodeURIComponent(props.username)}/learner-profile`)
    profile.value = result.learner_profile || {}
  } catch (cause) { feedback.value = cause instanceof Error ? cause.message : '学习者档案加载失败' }
  finally { loading.value = false }
}
onMounted(() => { void load() })
watch(() => props.username, () => { void load() })
async function save() {
  saving.value = true
  feedback.value = ''
  try {
    const cleaned = Object.fromEntries(Object.entries(profile.value).filter(([, value]) => value !== '' && value !== null && value !== undefined))
    const result = await api<{ learner_profile: Profile | null }>(`/api/auth/users/${encodeURIComponent(props.username)}/learner-profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleaned),
    })
    profile.value = result.learner_profile || {}
    feedback.value = '已保存'
  } catch (cause) { feedback.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { saving.value = false }
}
</script>

<template>
  <section class="admin-assignment admin-learner-profile-editor">
    <header><div><h3>学习者档案</h3><p>用于调整对这位学习者的讲解方式。</p></div><button type="button" class="admin-ghost-save" :disabled="loading || saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button></header>
    <div class="admin-profile-fields">
      <label>年龄 <input v-model.number="profile.age" type="number" min="3" max="120" /></label>
      <label v-for="field in fields" :key="field.key">{{ field.label }} <input v-model.trim="profile[field.key]" type="text" maxlength="80" /></label>
    </div>
    <p v-if="feedback" class="admin-editor-status" :class="{ ok: feedback === '已保存' }" role="status">{{ feedback }}</p>
  </section>
</template>
