<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'

interface Model { id?: string; name?: string; model?: string }
interface Profile { id?: string; name?: string; binding?: string; models: Model[] }
interface ModelService { active_profile_id?: string; active_model_id?: string; profiles: Profile[] }
interface Snapshot { generated_at: string; models: Record<string, ModelService>; mcp: { name: string; enabled: boolean; transport: string }[] }
const props = defineProps<{ language?: string }>()
const tr = (zh: string, en: string) => props.language === 'en' ? en : zh
const snapshot = ref<Snapshot | null>(null)
const busy = ref(false)
const error = ref('')
async function refresh() {
  busy.value = true
  error.value = ''
  try { snapshot.value = await api<Snapshot>('/api/settings/workspace/registrations/system-snapshot', { method: 'POST' }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '' + tr('配置快照加载失败', 'Failed to load configuration snapshot') + '' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="system-workspace-snapshot">
    <div class="snapshot-actions">
      <button type="button" :disabled="busy" @click="refresh"><LegacyIcon name="history" :size="13" />{{ tr('查看 / 刷新配置快照', 'View / refresh configuration snapshot') }}</button>
      <RouterLink to="/space/skills">{{ tr('技能', 'Skills') }}</RouterLink><RouterLink to="/space/mcp">MCP</RouterLink>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="snapshot" class="snapshot-content">
      <p class="muted">{{ tr('快照更新于', 'Snapshot updated') }} {{ new Date(snapshot.generated_at).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN') }}</p>
      <section v-for="(service, key) in snapshot.models" :key="key"><h4>{{ key }}</h4>
        <template v-for="profile in service.profiles" :key="profile.id">
          <p v-for="model in profile.models" :key="`${profile.id}:${model.id}`" class="snapshot-model"><span>{{ model.name || model.model }}{{ model.id === service.active_model_id && profile.id === service.active_profile_id ? tr(' · 当前使用', ' · Active') : '' }}</span><span class="muted">{{ profile.name || profile.binding }}</span></p>
        </template>
        <p v-if="service.profiles.every(profile => !profile.models.length)" class="muted">{{ tr('未配置模型', 'No models configured') }}</p>
      </section>
      <section v-if="snapshot.mcp.length"><h4>MCP</h4><p v-for="(server, index) in snapshot.mcp" :key="`${server.name}:${index}`">{{ server.name }} · {{ server.transport }} · {{ server.enabled ? tr('已启用', 'Enabled') : tr('已禁用', 'Disabled') }}</p></section>
      <p v-if="!Object.keys(snapshot.models).length && !snapshot.mcp.length">{{ tr('尚未配置模型或 MCP 服务器。', 'No models or MCP servers configured.') }}</p>
    </div>
  </div>
</template>

<style scoped>
.system-workspace-snapshot{margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:12px}.snapshot-actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px}.snapshot-actions button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:inherit;font:inherit;cursor:pointer}.snapshot-actions button:hover,.snapshot-actions a:hover{text-decoration:underline}.snapshot-actions button:disabled{opacity:.5;cursor:default}.snapshot-actions a{color:inherit}.snapshot-content{display:grid;gap:12px;margin-top:16px}.snapshot-content p{margin:0}.snapshot-content section{padding:12px;border-radius:8px;background:var(--muted)}.snapshot-content h4{margin:0 0 8px;text-transform:uppercase;font-size:12px}.snapshot-model{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px;padding:4px 0}.muted{color:var(--muted-foreground)}
</style>
