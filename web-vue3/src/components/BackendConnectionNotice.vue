<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { BACKEND_UNAVAILABLE_MESSAGE } from '../api'

const unavailable = ref(false)
function unavailableHandler() { unavailable.value = true }
function availableHandler() { unavailable.value = false }
function retry() { window.location.reload() }
onMounted(() => {
  window.addEventListener('deeptutor:backend-unavailable', unavailableHandler)
  window.addEventListener('deeptutor:backend-available', availableHandler)
})
onUnmounted(() => {
  window.removeEventListener('deeptutor:backend-unavailable', unavailableHandler)
  window.removeEventListener('deeptutor:backend-available', availableHandler)
})
</script>

<template>
  <aside v-if="unavailable" class="backend-connection-notice" role="alert">
    <LegacyIcon name="plug" :size="16" />
    <span><strong>开发后端未连接</strong>{{ BACKEND_UNAVAILABLE_MESSAGE }}</span>
    <button type="button" @click="retry">重试</button>
  </aside>
</template>
