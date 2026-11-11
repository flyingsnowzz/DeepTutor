<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authStatus, post } from '../api'

const props = defineProps<{ mode: 'login' | 'register' | 'admin' }>()
const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const error = ref('')
const subtitle = props.mode === 'register' ? '创建你的账户' : props.mode === 'admin' ? '管理员登录' : '登录到你的账户'
const actionLabel = props.mode === 'register' ? '创建账户' : '登录'
function nextPath() {
  const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') && !route.query.next.startsWith('//') ? route.query.next : '/chat'
  return next.includes('#') ? next : `${next}${window.location.hash}`
}
onMounted(async () => {
  const status = await authStatus().catch(() => null)
  if (!status?.authenticated) return
  if (props.mode === 'admin' && status.is_admin) await router.replace('/admin/users')
  else if (props.mode !== 'admin') await router.replace(nextPath())
})
async function submit() {
  if (props.mode === 'register' && password.value !== confirmPassword.value) { error.value = '两次输入的密码不一致'; return }
  busy.value = true
  error.value = ''
  try {
    const path = props.mode === 'register' ? '/api/auth/register' : props.mode === 'admin' ? '/api/auth/admin/login' : '/api/auth/login'
    await post(path, { username: username.value, password: password.value })
    if (props.mode === 'register') await router.replace('/login?registered=1')
    else if (props.mode === 'admin') await router.replace('/admin/users')
    else await router.replace(nextPath())
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '登录失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-container">
      <header class="auth-brand"><h1>DeepTutor</h1><p>{{ subtitle }}</p></header>
      <div v-if="route.query.registered === '1'" class="auth-registered" role="status">账户创建成功！请登录以继续。</div>
      <form class="auth-card" @submit.prevent="submit">
        <label for="username">邮箱或用户名<input id="username" v-model.trim="username" required autocomplete="username" :placeholder="mode === 'admin' ? '' : 'you@example.com'"></label>
        <label for="password">密码<input id="password" v-model="password" required type="password" :placeholder="mode === 'admin' ? '' : '••••••••'" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"></label><small v-if="mode === 'register'" class="auth-password-hint">至少 8 个字符</small><label v-if="mode === 'register'" for="confirmPassword">确认密码<input id="confirmPassword" v-model="confirmPassword" required type="password" autocomplete="new-password" placeholder="••••••••"></label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="primary" :disabled="busy">{{ busy ? props.mode === 'register' ? '正在创建账户…' : '登录中…' : actionLabel }}</button>
      </form>
      <p v-if="mode === 'login'" class="auth-secondary">还没有账号？<RouterLink to="/register">注册一个</RouterLink></p>
      <p v-if="mode === 'login'" class="auth-secondary"><RouterLink to="/admin/login">管理员登录</RouterLink></p>
      <p v-if="mode === 'register'" class="auth-secondary">已有账号？<RouterLink to="/login">登录</RouterLink></p>
      <p v-if="mode === 'admin'" class="auth-secondary"><RouterLink to="/login">用户登录</RouterLink></p>
      <p v-if="mode !== 'admin'" class="auth-tagline">DeepTutor · 智能体原生学习</p>
    </div>
  </main>
</template>
