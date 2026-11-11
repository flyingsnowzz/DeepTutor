<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import LegacySidebar from '../components/LegacySidebar.vue'
import LegacyIcon from '../components/LegacyIcon.vue'
import BackendConnectionNotice from '../components/BackendConnectionNotice.vue'
const sidebar = ref<InstanceType<typeof LegacySidebar> | null>(null)
const route = useRoute()
const settingsRoute = computed(() => route.path === '/settings' || route.path.startsWith('/settings/'))
</script>
<template>
  <BackendConnectionNotice />
  <RouterView v-if="settingsRoute" />
  <div v-else class="app-shell legacy-app-shell">
    <LegacySidebar ref="sidebar" />
    <div class="main-area legacy-main-area">
      <header class="legacy-mobile-topbar"><button type="button" aria-label="打开导航" @click="sidebar?.openDrawer()"><LegacyIcon name="menu" :size="18" /></button><RouterLink to="/chat"><img src="/brand/color-logo.png" alt=""><img src="/brand/color-word.png" alt="DeepTutor"></RouterLink></header>
      <RouterView />
    </div>
  </div>
</template>
