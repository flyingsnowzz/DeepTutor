<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { SetupCredentialData } from '../setupSignals'

defineProps<{ data: SetupCredentialData }>()
const router = useRouter()
</script>

<template>
  <section class="setup-credential-card" aria-label="需要配置凭据">
    <div class="setup-credential-icon" aria-hidden="true">🔑</div>
    <div class="setup-credential-body">
      <h3>这一步需要凭据</h3>
      <p>{{ data.reason || '请在设置页填写密钥，不要在聊天中发送，避免密钥进入对话记录。' }}</p>
      <button type="button" @click="router.push(data.settingsPath)">打开设置 <span aria-hidden="true">→</span></button>
    </div>
  </section>
</template>
