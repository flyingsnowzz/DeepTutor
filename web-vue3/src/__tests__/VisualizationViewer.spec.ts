import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import VisualizationViewer from '../components/VisualizationViewer.vue'
import type { VisualizeCanvasResult, VisualizeResult } from '../visualizeResult'
import Chart from 'chart.js/auto'

vi.mock('chart.js/auto', () => ({
  default: class MockChart {
    static instances: MockChart[] = []
    destroy = vi.fn()
    constructor(public canvas: HTMLCanvasElement, public config: unknown) {
      MockChart.instances.push(this)
    }
  },
}))

vi.mock('../components/MermaidBlock.vue', () => ({
  default: {
    props: ['code', 'language'],
    template: '<div class="mermaid-stub">{{ code }}</div>',
  },
}))

vi.mock('../components/Geogebra.vue', () => ({
  default: {
    props: ['payload', 'script', 'title'],
    template: '<div class="geogebra-stub" />',
  },
}))

function canvas(overrides: Partial<VisualizeCanvasResult> = {}): VisualizeCanvasResult {
  return {
    schema_version: 'v1',
    response: '',
    render_type: 'svg',
    renderer: { id: 'svg', version: '1', target: 'native', native_renderer: 'svg', entry_url: '' },
    payload: { format: 'image/svg+xml', data: '' },
    presentation: { title: '图', description: '', alt_text: '', aspect_ratio: '' },
    interaction: { events: [] },
    fallback: {},
    code: {
      language: 'svg',
      content: '<svg id="a" width="10" height="10"><rect id="r" width="1" height="1"/></svg>',
    },
    analysis: {
      render_type: 'svg',
      description: '',
      data_description: '',
      chart_type: '',
      visual_elements: [],
      rationale: '',
    },
    review: { optimized_code: '', changed: false, review_notes: '' },
    ...overrides,
  }
}

describe('VisualizationViewer', () => {
  it('renders sanitized SVG and forwards data-prompt clicks as composer events', () => {
    const listener = vi.fn()
    window.addEventListener('dt:visualize-prompt', listener)
    const result = canvas({
      code: {
        language: 'svg',
        content: '<svg><rect data-prompt="Explain this" onclick="bad()"/></svg>',
      },
    })
    const wrapper = mount(VisualizationViewer, { props: { result } })
    expect(wrapper.find('.visualization-svg-root').html()).toContain('data-prompt')
    expect(wrapper.find('.visualization-svg-root').html()).not.toContain('onclick')
    wrapper.find('[data-prompt]').trigger('click')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Explain this' }))
    window.removeEventListener('dt:visualize-prompt', listener)
  })

  it('renders mermaid and chart config through native renderers', async () => {
    const mermaid = canvas({
      render_type: 'mermaid',
      renderer: { id: 'mermaid', version: '1', target: 'native', native_renderer: 'mermaid', entry_url: '' },
      code: { language: 'mermaid', content: 'graph TD; A-->B' },
    })
    const mermaidWrapper = mount(VisualizationViewer, { props: { result: mermaid } })
    expect(mermaidWrapper.find('.mermaid-stub').text()).toContain('graph TD')

    const chart = canvas({
      render_type: 'chartjs',
      renderer: { id: 'chartjs', version: '1', target: 'native', native_renderer: 'chartjs', entry_url: '' },
      analysis: { ...canvas().analysis, chart_type: 'bar' },
      code: { language: 'javascript', content: '{type:"bar",data:{labels:["A"]}}' },
    })
    const chartWrapper = mount(VisualizationViewer, { props: { result: chart } })
    await flushPromises()
    expect(chartWrapper.find('canvas').exists()).toBe(true)
    expect((Chart as unknown as { instances: unknown[] }).instances).toHaveLength(1)
  })

  it('shows and copies code, then hides it again', async () => {
    const result = canvas()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mount(VisualizationViewer, { props: { result } })
    expect(wrapper.find('.visualization-code').exists()).toBe(false)
    await wrapper.findAll('.visualization-toolbar button')[0].trigger('click')
    expect(wrapper.find('.visualization-code').text()).toContain('<svg')
    await wrapper.findAll('.visualization-toolbar button')[1].trigger('click')
    expect(writeText).toHaveBeenCalledWith(result.code.content)
  })

  it('delegates Manim envelopes to MathAnimatorViewer', () => {
    const result: VisualizeResult = {
      render_type: 'manim_video',
      manim: {
        response: '',
        output_mode: 'video',
        code: { language: 'python', content: '' },
        artifacts: [],
        timings: {},
        render: {},
      },
    }
    const wrapper = mount(VisualizationViewer, {
      props: { result },
      global: {
        stubs: { MathAnimatorViewer: { template: '<div class="manim-stub" />' } },
      },
    })
    expect(wrapper.find('.manim-stub').exists()).toBe(true)
  })
})
