<script setup lang="ts">
import { computed } from 'vue'
import CodeBlockPreview from './CodeBlockPreview.vue'
interface UiAppearance { theme?: string; code_block_theme?: string; code_block_show_line_numbers?: boolean; code_block_wrap_long_lines?: boolean }
const props = defineProps<{ ui: UiAppearance; language?: string }>()
const emit = defineEmits<{ change: [patch: Partial<UiAppearance>] }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const themes = [
  { id: 'snow', label: '默认', english: 'Default', bg: '#ffffff', fg: '#0d0d0d', card: '#ffffff', primary: '#2563eb', muted: '#f2f2f2', border: '#e5e5e5' },
  { id: 'light', label: '奶油', english: 'Cream', bg: '#fdfcf9', fg: '#1c1816', card: '#ffffff', primary: '#b0501e', muted: '#f1ede2', border: '#e6decc' },
  { id: 'dark', label: '深色', english: 'Dark', bg: '#1a1918', fg: '#e8e4de', card: '#242220', primary: '#d4734b', muted: '#2a2725', border: '#3a3634' },
  { id: 'glass', label: '琉璃', english: 'Glass', bg: '#0e0d1a', fg: '#ffffff', card: 'rgba(255,255,255,.06)', primary: '#a855f7', muted: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.12)' },
]
const codeThemes = [
  ['a11yDark', 'A11Y Dark'], ['a11yOneLight', 'A11Y One Light'], ['atomDark', 'Atom Dark'], ['base16AteliersulphurpoolLight', 'Base16 Atelier Sulphurpool Light'],
  ['cb', 'CB'], ['coldarkCold', 'Coldark Cold'], ['coldarkDark', 'Coldark Dark'], ['coyWithoutShadows', 'Coy Without Shadows'], ['coy', 'Coy'], ['darcula', 'Darcula'],
  ['dark', 'Dark'], ['dracula', 'Dracula'], ['duotoneDark', 'Duotone Dark'], ['duotoneEarth', 'Duotone Earth'], ['duotoneForest', 'Duotone Forest'], ['duotoneLight', 'Duotone Light'],
  ['duotoneSea', 'Duotone Sea'], ['duotoneSpace', 'Duotone Space'], ['funky', 'Funky'], ['ghcolors', 'GH Colors'], ['gruvboxDark', 'Gruvbox Dark'], ['gruvboxLight', 'Gruvbox Light'],
  ['holiTheme', 'Holi Theme'], ['hopscotch', 'Hopscotch'], ['lucario', 'Lucario'], ['materialDark', 'Material Dark'], ['materialLight', 'Material Light'], ['materialOceanic', 'Material Oceanic'],
  ['nightOwl', 'Night Owl'], ['nord', 'Nord'], ['okaidia', 'Okaidia'], ['oneDark', 'One Dark'], ['oneLight', 'One Light'], ['pojoaque', 'Pojoaque'], ['prism', 'Prism'],
  ['shadesOfPurple', 'Shades of Purple'], ['solarizedDarkAtom', 'Solarized Dark Atom'], ['solarizedlight', 'Solarized Light'], ['synthwave84', 'Synthwave 84'], ['tomorrow', 'Tomorrow'],
  ['twilight', 'Twilight'], ['vsDark', 'VS Dark'], ['vs', 'VS'], ['vscDarkPlus', 'VSC Dark Plus'], ['xonokai', 'Xonokai'], ['zTouch', 'Z Touch'],
]
const previewSnippet = `def fibonacci(n):
    """Generate the first n Fibonacci numbers."""
    a, b = 0, 1
    result = []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b
    return result


# Build a deliberately long summary so the wrapping preference is easy to see
summary = f"First twenty Fibonacci values rendered with the selected syntax theme, line-number setting, and wrapping preference: {', '.join(str(value) for value in fibonacci(20))}"
print(summary)
`
function change(patch: Partial<UiAppearance>) { emit('change', patch) }
</script>

<template>
  <div>
    <header class="legacy-settings-page-header"><h1>{{ tr('外观', 'Appearance') }}</h1><p>{{ tr('自定义主题和代码块样式，通过底部操作栏应用更改。', 'Customize the visual theme and code blocks. Apply changes using the bar below.') }}</p></header>
    <section class="legacy-setting-section"><header><h2>{{ tr('主题', 'Theme') }}</h2><p>{{ tr('选择配色和界面风格。每个卡片预览对应主题的实际效果。', 'Pick the colour palette and interface style. Each tile previews the theme it applies.') }}</p></header><div class="legacy-setting-section-body"><div class="legacy-theme-grid">
      <button v-for="theme in themes" :key="theme.id" type="button" class="legacy-theme-card" :class="{ selected: (ui.theme || 'snow') === theme.id }" :aria-pressed="(ui.theme || 'snow') === theme.id" @click="change({ theme: theme.id })">
        <div class="legacy-theme-preview" :data-theme-id="theme.id" :style="{ boxShadow: `inset 0 0 0 1px ${theme.border}` }">
          <svg viewBox="0 0 160 96" aria-hidden="true"><rect width="160" height="96" rx="6" :fill="theme.bg"/><defs v-if="theme.id === 'glass'"><radialGradient id="glass-theme-preview-shine" cx="20%" cy="0%" r="80%"><stop offset="0%" stop-color="rgba(168,85,247,0.38)"/><stop offset="100%" stop-color="rgba(168,85,247,0)"/></radialGradient></defs><rect v-if="theme.id === 'glass'" width="160" height="96" rx="6" fill="url(#glass-theme-preview-shine)"/><rect width="44" height="96" :fill="theme.muted"/><rect x="8" y="14" width="28" height="3" rx="1.5" :fill="theme.fg" opacity=".45"/><rect x="6" y="26" width="32" height="10" rx="3" :fill="theme.card"/><rect x="10" y="30" width="20" height="2.5" rx="1.25" :fill="theme.fg" opacity=".9"/><circle cx="40" cy="31" r="1.5" :fill="theme.primary"/><rect x="8" y="44" width="24" height="2.5" rx="1.25" :fill="theme.fg" opacity=".45"/><rect x="8" y="54" width="26" height="2.5" rx="1.25" :fill="theme.fg" opacity=".45"/><rect x="8" y="64" width="22" height="2.5" rx="1.25" :fill="theme.fg" opacity=".45"/><line x1="44" y1="0" x2="44" y2="96" :stroke="theme.border" stroke-width=".5"/><rect x="54" y="14" width="96" height="68" rx="4" :fill="theme.card" :stroke="theme.border" stroke-width=".5"/><rect x="62" y="22" width="40" height="3.5" rx="1.5" :fill="theme.fg" opacity=".85"/><rect x="62" y="34" width="78" height="2.5" rx="1.25" :fill="theme.fg" opacity=".35"/><rect x="62" y="42" width="64" height="2.5" rx="1.25" :fill="theme.fg" opacity=".35"/><rect x="62" y="50" width="72" height="2.5" rx="1.25" :fill="theme.fg" opacity=".35"/><rect x="62" y="64" width="22" height="9" rx="2.5" :fill="theme.primary"/></svg>
          <span v-if="(ui.theme || 'snow') === theme.id" class="legacy-theme-check">✓</span>
        </div>
        <div class="legacy-theme-label"><span>{{ chinese ? theme.label : theme.english }}</span><div><i :style="{ background: theme.primary }"/><i :style="{ background: theme.fg }"/><i :style="{ background: theme.muted }"/></div></div>
      </button>
    </div><p class="legacy-theme-note">{{ tr('默认主题为简洁的纯白配色，带蓝色点缀。Cream 温暖如纸，带陶土色点缀。Dark 在近黑背景上延续 Cream 的暖意。Glass 在深色渐变上加入半透明紫色面板。', `Default is a clean pure-white theme with a blue accent. Cream is warm and paper-like with a terracotta accent. Dark keeps Cream's warmth on near-black. Glass adds translucent purple panels on a deep gradient.`) }}</p></div></section>
    <section class="legacy-setting-section"><header><h2>{{ tr('代码块', 'Code blocks') }}</h2><p>{{ tr('选择应用更改后，整个应用中的代码片段样式。', 'Choose how code snippets look across the app after you apply changes.') }}</p></header><div class="legacy-setting-section-body">
      <div class="legacy-code-preview-heading"><h3>{{ tr('预览', 'Preview') }}</h3><p>{{ tr('修改下方设置时预览会实时更新。', 'Updates live as you change the settings below.') }}</p><CodeBlockPreview :raw="previewSnippet" :theme="ui.code_block_theme || 'oneDark'" :show-line-numbers="ui.code_block_show_line_numbers !== false" :wrap-long-lines="Boolean(ui.code_block_wrap_long_lines)" /></div>
      <div class="legacy-setting-row"><div><h3>{{ tr('语法主题', 'Syntax theme') }}</h3><p>{{ tr('选择用于代码块高亮的 Prism 主题。', 'Select the Prism theme used for highlighted code blocks.') }}</p></div><select :value="ui.code_block_theme || 'oneDark'" :aria-label="tr('语法主题', 'Syntax theme')" @change="change({ code_block_theme: ($event.target as HTMLSelectElement).value })"><option v-for="item in codeThemes" :key="item[0]" :value="item[0]">{{ item[1] }}</option></select></div>
      <div class="legacy-setting-row"><div><h3>{{ tr('显示行号', 'Show line numbers') }}</h3><p>{{ tr('在每个代码块旁显示带行号的边栏。', 'Display a gutter with line numbers beside each code block.') }}</p></div><button type="button" role="switch" :aria-label="tr('显示行号', 'Show line numbers')" :aria-checked="ui.code_block_show_line_numbers !== false" class="legacy-toggle" :class="{ on: ui.code_block_show_line_numbers !== false }" @click="change({ code_block_show_line_numbers: ui.code_block_show_line_numbers === false })"><span /></button></div>
      <div class="legacy-setting-row"><div><h3>{{ tr('长行换行', 'Wrap long lines') }}</h3><p>{{ tr('换行显示较长的代码行，避免强制横向滚动。', 'Wrap long code lines instead of forcing horizontal scrolling.') }}</p></div><button type="button" role="switch" :aria-label="tr('长行换行', 'Wrap long lines')" :aria-checked="Boolean(ui.code_block_wrap_long_lines)" class="legacy-toggle" :class="{ on: ui.code_block_wrap_long_lines }" @click="change({ code_block_wrap_long_lines: !ui.code_block_wrap_long_lines })"><span /></button></div>
    </div></section>
  </div>
</template>
