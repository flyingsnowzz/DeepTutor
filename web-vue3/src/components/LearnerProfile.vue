<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { api } from '../api'

type Profile = Record<string, string | number | undefined>
const props = defineProps<{ pending?: Profile; revision?: number }>()
const emit = defineEmits<{ change: [value: Profile]; loaded: [value: Profile] }>()
const profile = reactive<Profile>({})
const error = ref('')
const loading = ref(true)
const fields = [
  ['age', '年龄'], ['grade_level', '年级'], ['curriculum', '课程体系'],
  ['language', '首选语言'], ['reading_level', '阅读水平'], ['explanation_style', '讲解方式'],
]
async function load() {
  loading.value = true
  error.value = ''
  try {
    const live = (await api<{ learner_profile?: Profile | null }>('/api/auth/profile/learner-profile')).learner_profile || {}
    emit('loaded', live)
    for (const key of Object.keys(profile)) delete profile[key]
    Object.assign(profile, props.pending ?? live)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '档案加载失败' }
  finally { loading.value = false }
}
onMounted(load)
watch(() => props.revision, () => { void load() })
function change(key: string, value: string) {
  profile[key] = key === 'age' ? (value ? Number(value) : undefined) : value || undefined
  emit('change', Object.fromEntries(Object.entries(profile).filter(([, item]) => item !== '' && item !== undefined && item !== null)))
}
</script>

<template>
  <main class="learner-profile-settings">
    <h1>学习者档案</h1><p>用于调整讲解方式和阅读支持。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted">正在加载档案…</p>
    <div v-else class="profile-fields">
      <label v-for="[key, label] in fields" :key="key">{{ label }}<input :value="profile[key] ?? ''" :type="key === 'age' ? 'number' : 'text'" :min="key === 'age' ? 3 : undefined" :max="key === 'age' ? 120 : undefined" @input="change(key, ($event.target as HTMLInputElement).value)"></label>
    </div>
  </main>
</template>

<style scoped>
.learner-profile-settings{max-width:672px;margin:auto;padding:32px 24px}
.learner-profile-settings h1{font-size:20px;font-weight:600;margin:0}
.learner-profile-settings>p{font-size:14px;color:var(--muted-foreground);margin:4px 0 24px}
.profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.profile-fields label{display:grid;gap:5px;font-size:14px}
.profile-fields input{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--background)}
@media(max-width:640px){.profile-fields{grid-template-columns:1fr}}
</style>
