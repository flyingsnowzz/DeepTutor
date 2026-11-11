<script setup lang="ts">
type Tool = { name: string; description?: string }
const props = defineProps<{ tools: Tool[]; builtinTools: Tool[]; mcpTools: Tool[]; enabled: string[]; builtin: string[]; mcp: string[] }>()
const emit = defineEmits<{ 'update:enabled': [string[]]; 'update:builtin': [string[]]; 'update:mcp': [string[]] }>()
function toggle(list: string[], name: string, emitUpdate: (next: string[]) => void) { emitUpdate(list.includes(name) ? list.filter(item => item !== name) : [...list, name]) }
</script>

<template>
  <div class="partner-tool-picker">
    <section>
      <header><h4>系统工具</h4><div><button type="button" @click="emit('update:enabled', tools.map(tool => tool.name))">全部</button><button type="button" @click="emit('update:enabled', [])">无</button></div></header>
      <div class="partner-tool-grid"><label v-for="tool in tools" :key="tool.name"><input type="checkbox" :checked="enabled.includes(tool.name)" @change="toggle(enabled, tool.name, $event => emit('update:enabled', $event))"><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span></label></div>
    </section>
    <section v-if="builtinTools.length">
      <header><h4>内置工具</h4><div><button type="button" @click="emit('update:builtin', builtinTools.map(tool => tool.name))">全部</button><button type="button" @click="emit('update:builtin', [])">无</button></div></header>
      <p>在上下文需要时自动挂载——已附加知识库、有可用记忆、已启用沙箱等。可以关闭不想授予该伙伴的工具。</p>
      <div class="partner-tool-grid"><label v-for="tool in builtinTools" :key="tool.name"><input type="checkbox" :checked="builtin.includes(tool.name)" @change="toggle(builtin, tool.name, $event => emit('update:builtin', $event))"><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span></label></div>
    </section>
    <section><h4>记忆</h4><p>始终启用且不可配置。partner_read 可读取所有者的共享记忆和伙伴自身的记忆；partner_memorize 仅写入伙伴自身的记忆；partner_search 按关键词搜索历史对话。</p></section>
    <section v-if="mcpTools.length">
      <header><h4>MCP 工具</h4><div><button type="button" @click="emit('update:mcp', mcpTools.map(tool => tool.name))">全部</button><button type="button" @click="emit('update:mcp', [])">无</button></div></header>
      <div class="partner-tool-grid"><label v-for="tool in mcpTools" :key="tool.name"><input type="checkbox" :checked="mcp.includes(tool.name)" @change="toggle(mcp, tool.name, $event => emit('update:mcp', $event))"><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span></label></div>
    </section>
  </div>
</template>
