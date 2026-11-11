<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import LegacyIcon from './LegacyIcon.vue'
import { masteryHandoffHref, type MasteryHandoffPayload } from '../masteryHandoff'
import { setMasteryOpeningPrompt } from '../pendingPrompt'

const props = defineProps<{ data: MasteryHandoffPayload }>()
const router = useRouter()
const draft = ref(props.data.opening_message)

const stats = [
  props.data.objectives > 0 ? `${props.data.mastered}/${props.data.objectives} 已掌握` : '',
  props.data.due_reviews > 0 ? `${props.data.due_reviews} 待复习` : '',
].filter(Boolean)

function go() {
  const opening = draft.value.trim()
  if (opening) setMasteryOpeningPrompt(opening)
  void router.push(masteryHandoffHref(props.data))
}
</script>

<template>
  <section class="mastery-handoff-card">
    <div class="mastery-handoff-icon">
      <span v-if="data.emoji">{{ data.emoji }}</span>
      <LegacyIcon v-else :name="data.kind === 'new' ? 'sparkles' : 'bookOpen'" :size="15" />
    </div>
    <div class="mastery-handoff-body">
      <h3>{{ data.reason || (data.kind === 'open' ? '从上次学习进度继续' : '在这条学习路径上开始新会话') }}</h3>
      <div class="mastery-handoff-meta">
        <strong>{{ data.path_name || '精通之路' }}</strong>
        <span v-if="data.module_name" class="module-chip">{{ data.module_name }}</span>
      </div>
      <div v-if="stats.length" class="mastery-handoff-stats">
        <i :style="{ width: `${data.objectives ? Math.round((data.mastered / data.objectives) * 100) : 0}%` }" />
        <span>{{ stats.join(' · ') }}</span>
      </div>
      <label v-if="draft || data.opening_message" class="mastery-handoff-draft">
        <span>打开时的开场白</span>
        <textarea v-model="draft" rows="2"></textarea>
      </label>
      <div class="mastery-handoff-actions">
        <button type="button" class="primary" @click="go">
          <LegacyIcon :name="data.kind === 'open' ? 'rotateCcw' : 'sparkles'" :size="12" />
          {{ data.kind === 'open' ? '继续学习' : '开始学习' }}
        </button>
        <span v-if="data.kind === 'new'">学习路径会保留全部进度。</span>
      </div>
    </div>
  </section>
</template>
