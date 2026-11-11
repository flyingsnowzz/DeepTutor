import { describe, expect, it } from 'vitest'
import { buildGraph, parseDoc, splitRef, SURFACES, L3_SLOTS, type RawMemorySnapshot } from '../graph'

const entry = 'm_00000000000000000000000000'
function snapshot(): RawMemorySnapshot {
  const l1 = Object.fromEntries(SURFACES.map(surface => [
    surface,
    surface === 'chat' ? [{ id: 'e1', label: 'Conversation', ts: '2026-01-01', content: 'Raw memory' }] : [],
  ])) as RawMemorySnapshot['l1']
  const l2 = Object.fromEntries(SURFACES.map(surface => [
    surface,
    surface === 'chat'
      ? { title: 'Chat', entries: parseDoc(`# Chat\n\n- Summary [^1] <!--${entry}-->\n\n[^1]: chat:e1`).entries }
      : { title: surface, entries: [] },
  ])) as RawMemorySnapshot['l2']
  const l3 = Object.fromEntries(L3_SLOTS.map(slot => [
    slot,
    slot === 'profile'
      ? { title: 'Profile', entries: parseDoc(`# Profile\n\n- Preference [^1] <!--${entry}-->\n\n[^1]: chat:${entry}`).entries }
      : { title: slot, entries: [] },
  ])) as RawMemorySnapshot['l3']
  return { l1, l2, l3 }
}

describe('memory graph', () => {
  it('parses citations and splits compound refs without losing the id', () => {
    const doc = parseDoc(`# Doc\n\n- Text [^1] <!--${entry}-->\n\n[^1]: quiz:unified_1:q_2`)
    expect(doc.entries[0].refs).toEqual(['quiz:unified_1:q_2'])
    expect(splitRef('quiz:unified_1:q_2')).toEqual({ surface: 'quiz', entityId: 'unified_1:q_2' })
  })

  it('builds all layers and connects L3 to L2 and L2 to L1', () => {
    const graph = buildGraph(snapshot())
    expect(graph.nodes.some(node => node.id === 'L1:chat:e1')).toBe(true)
    expect(graph.nodes.some(node => node.id === `L2:chat:${entry}`)).toBe(true)
    expect(graph.nodes.some(node => node.id === `L3:profile:${entry}`)).toBe(true)
    expect(graph.edges).toContainEqual({ source: `L2:chat:${entry}`, target: 'L1:chat:e1', kind: 'strong' })
    expect(graph.edges).toContainEqual({ source: `L3:profile:${entry}`, target: `L2:chat:${entry}`, kind: 'strong' })
    expect(graph.adjacency.get(`L3:profile:${entry}`)).toContain(`L2:chat:${entry}`)
  })
})
