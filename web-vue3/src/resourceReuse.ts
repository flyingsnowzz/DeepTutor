export const RESOURCE_KINDS = [
  'attachments',
  'books',
  'reading',
  'notebooks',
  'chat_history',
  'my_agents',
  'question_bank',
  'memory',
  'knowledge',
  'persona',
  'agent',
  'partner',
  'partner_group',
  'skills',
  'mcp',
] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]
export type ResourceReusePolicy = Record<ResourceKind, boolean>

export const DEFAULT_RESOURCE_REUSE: ResourceReusePolicy = {
  attachments: false,
  books: false,
  reading: false,
  notebooks: false,
  chat_history: false,
  my_agents: false,
  question_bank: false,
  memory: false,
  knowledge: true,
  persona: true,
  agent: true,
  partner: true,
  partner_group: true,
  skills: true,
  mcp: true,
}

export function normalizeResourceReuse(
  policy: Partial<ResourceReusePolicy> = {},
): ResourceReusePolicy {
  return { ...DEFAULT_RESOURCE_REUSE, ...policy }
}

export function retainedKnowledgeBases(
  names: Iterable<string>,
  agents: ReadonlySet<string>,
  reuse: ResourceReusePolicy,
): string[] {
  return [...names].filter(name => reuse[agents.has(name) ? 'agent' : 'knowledge'])
}
