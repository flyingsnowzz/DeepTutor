<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ content: string; busy?: boolean }>(), { busy: false })
const emit = defineEmits<{ cancel: []; submit: [content: string] }>()
const draft = ref(props.content)
const textarea = ref<HTMLTextAreaElement | null>(null)
const composing = ref(false)
const rows = computed(() => Math.min(8, Math.max(2, draft.value.split('\n').length)))
const unchanged = computed(() => !draft.value.trim() || draft.value.trim() === props.content)
watch(() => props.content, value => { draft.value = value })
function cancel() { draft.value = props.content; emit('cancel') }
function submit() { if (!props.busy && !unchanged.value) emit('submit', draft.value.trim()) }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); cancel(); return }
  if (event.key === 'Enter' && !event.shiftKey && !composing.value) { event.preventDefault(); submit() }
}
void nextTick(() => { textarea.value?.focus(); textarea.value?.setSelectionRange(draft.value.length, draft.value.length) })
</script>

<template>
  <div class="chat-inline-edit">
    <textarea ref="textarea" v-model="draft" :rows="rows" :disabled="busy" aria-label="编辑消息" @keydown="keydown" @compositionstart="composing = true" @compositionend="composing = false" />
    <div class="chat-inline-edit-footer"><span>使用下方箭头在不同分支间切换。</span><div><button type="button" :disabled="busy" @click="cancel">取消</button><button type="button" class="primary" :disabled="busy || unchanged" @click="submit">发送</button></div></div>
  </div>
</template>
