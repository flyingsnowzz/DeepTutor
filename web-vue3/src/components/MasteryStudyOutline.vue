<script setup lang="ts">
import LegacyIcon from './LegacyIcon.vue'

export interface MasteryStudyPoint {
  id: string
  name: string
  status: string
}

export interface MasteryStudyTopic {
  path_id?: string
  name?: string
  metadata?: { goal?: string; description?: string; emoji?: string }
  next?: { knowledge_point_id?: string; knowledge_point_name?: string }
  map: {
    complete?: boolean
    counts: { mastered: number; total: number }
    modules: Array<{ id: string; name: string; knowledge_points: MasteryStudyPoint[] }>
  }
}

defineProps<{
  topic: MasteryStudyTopic
  currentPointId: string
  justMasteredId?: string | null
  collapsed: boolean
}>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button v-if="collapsed" type="button" class="mastery-outline-collapsed" :class="{ 'mastery-just-mastered-strip': justMasteredId }" aria-label="显示大纲" @click="emit('toggle')">
    <LegacyIcon name="expand" :size="16" />
    <span>大纲</span>
  </button>
  <nav v-else class="mastery-study-outline" aria-label="大纲">
    <div class="mastery-study-outline-head">
      <span>大纲</span>
      <div><span>{{ topic.map.counts.mastered }}/{{ topic.map.counts.total }}</span><button type="button" title="隐藏大纲" aria-label="隐藏大纲" @click="emit('toggle')"><LegacyIcon name="collapse" :size="14" /></button></div>
    </div>
    <div class="mastery-study-outline-modules">
      <section v-for="(module, index) in topic.map.modules" :key="module.id">
        <div class="mastery-study-module-title"><span>{{ String(index + 1).padStart(2, '0') }}</span><h2>{{ module.name }}</h2></div>
        <ul>
          <li v-for="point in module.knowledge_points" :key="point.id">
            <div class="mastery-study-point" :class="{ current: point.id === currentPointId, 'mastery-just-mastered-row': point.id === justMasteredId }">
              <span class="mastery-study-point-mark" :class="{ 'mastery-just-mastered-halo': point.id === justMasteredId }">
                <i v-if="point.status === 'mastered'" class="mastered" :class="{ 'mastery-just-mastered-dot': point.id === justMasteredId }" />
                <i v-else-if="point.id === currentPointId" class="current" />
                <i v-else :class="{ learning: point.status === 'learning' }" />
              </span>
              <span class="mastery-study-point-name" :class="{ mastered: point.status === 'mastered', current: point.id === currentPointId || point.id === justMasteredId }">{{ point.name }}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </nav>
</template>
