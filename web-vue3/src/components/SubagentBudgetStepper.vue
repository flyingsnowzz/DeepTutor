<script setup lang="ts">
import {
  canDecrease,
  canIncrease,
  CONSULT_BUDGET_MAX,
  CONSULT_BUDGET_MIN,
  decreaseBudget,
  displayBudget,
  increaseBudget,
} from '../subagentBudget'
import LegacyIcon from './LegacyIcon.vue'

const props = defineProps<{ modelValue: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function stepDown() {
  if (!canDecrease(props.modelValue)) return
  emit('update:modelValue', decreaseBudget(props.modelValue))
}
function stepUp() {
  if (!canIncrease(props.modelValue)) return
  emit('update:modelValue', increaseBudget(props.modelValue))
}
</script>

<template>
  <div class="subagent-budget" role="group" aria-label="最多可咨询轮数">
    <span>DeepTutor 最多可咨询的轮数（{{ CONSULT_BUDGET_MIN }}–{{ CONSULT_BUDGET_MAX }}）</span>
    <span class="subagent-budget-control">
      <button type="button" aria-label="减少轮数" :disabled="!canDecrease(modelValue)" @click="stepDown">
        <LegacyIcon name="minus" :size="12" />
      </button>
      <span class="subagent-budget-value" aria-live="polite">{{ displayBudget(modelValue) }}</span>
      <button type="button" aria-label="增加轮数" :disabled="!canIncrease(modelValue)" @click="stepUp">
        <LegacyIcon name="plus" :size="12" />
      </button>
    </span>
  </div>
</template>
