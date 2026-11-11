<script setup lang="ts">
import { ref } from 'vue'
import LegacyIcon from './LegacyIcon.vue'

const open = ref(false)
const copyState = ref<'idle' | 'copying' | 'copied' | 'failed'>('idle')
const prompt = `请帮我配置已经安装的 DeepTutor：https://github.com/HKUDS/DeepTutor。
先阅读对应版本源码中的 SKILL.md 和 docs-for-dev/AGENT_SETUP.md；没有本地源码时，从上述仓库读取指南。
确认安装方式、版本、正在运行的实例、账号和运行目录，复用现有环境，保留已有文件、设置和待应用的草稿。
帮我连接提供方并选择对话模型，嵌入模型、搜索等其他服务按需配置。缺少模型选择或凭据来源时再问我，不要让我在聊天中粘贴 API Key，也不要输出密钥。
根据指南和已安装 CLI 的 --help 完成配置，并验证当前这个实例是否可用。最后告诉我改了什么、实际检查结果和仍需完成的步骤。`

function showDialog() { copyState.value = 'idle'; open.value = true }
async function copyPrompt() {
  copyState.value = 'copying'
  try {
    await navigator.clipboard.writeText(prompt)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
}
</script>

<template>
  <div class="agent-setup-help"><p>按下方步骤完成配置，也可以交给你自己的 Agent。</p><button type="button" @click="showDialog"><LegacyIcon name="agents" :size="16" />让你的 Agent 帮你配置</button></div>
  <Teleport to="body"><div v-if="open" class="agent-setup-overlay" @click.self="open = false"><section class="agent-setup-dialog" role="dialog" aria-modal="true" aria-label="让你的 Agent 帮你配置"><header><h2>让你的 Agent 帮你配置</h2><button type="button" aria-label="关闭" @click="open = false"><LegacyIcon name="close" :size="17" /></button></header><div class="agent-setup-body"><p>复制这段提示词，粘贴给能够通过终端访问 DeepTutor 安装环境的 Agent，例如 Codex 或 Claude Code。</p><textarea readonly aria-label="让你的 Agent 帮你配置" :value="prompt" @focus="($event.target as HTMLTextAreaElement).select()"></textarea></div><footer><p role="status">{{ copyState === 'failed' ? '复制失败，请选中上方文本手动复制。' : copyState === 'copied' ? '已复制' : '' }}</p><button type="button" :disabled="copyState === 'copying'" @click="copyPrompt"><LegacyIcon :name="copyState === 'copied' ? 'check' : 'copy'" :size="16" />复制提示词</button></footer></section></div></Teleport>
</template>
