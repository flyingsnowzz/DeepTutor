import { describe, expect, it } from 'vitest'
import { collectAppliedSettingIds, extractSetupCredential } from '../setupSignals'

const credentialEvent = {
  type: 'tool_result',
  tool_call_id: 'call-1',
  metadata: {
    tool_metadata: {
      setup_credential: {
        service: 'llm',
        label: 'OpenAI',
        settings_path: '/settings/connections',
        reason: 'API key missing',
      },
    },
  },
}

describe('setup signals', () => {
  it('extracts the latest safe settings credential hand-off', () => {
    expect(extractSetupCredential([credentialEvent])).toEqual({
      service: 'llm',
      label: 'OpenAI',
      settingsPath: '/settings/connections',
      reason: 'API key missing',
    })
    expect(
      extractSetupCredential([
        {
          type: 'tool_result',
          metadata: {
            tool_metadata: {
              setup_credential: { settings_path: 'https://evil.example/settings' },
            },
          },
        },
      ]),
    ).toBeNull()
    expect(extractSetupCredential(undefined)).toBeNull()
  })

  it('collects applied setting ids once and falls back to key plus sequence', () => {
    const messages = [
      {
        events: [
          credentialEvent,
          {
            type: 'tool_result',
            tool_call_id: 'applied-1',
            metadata: { tool_metadata: { setup_applied: { key: 'interface.theme' } } },
          },
          { type: 'tool_result', seq: 7, metadata: { tool_metadata: { setup_applied: { key: 'interface.font' } } } },
        ],
      },
      { events: [{ type: 'tool_result', tool_call_id: 'applied-1', metadata: { tool_metadata: { setup_applied: { key: 'interface.theme' } } } }] },
    ]
    expect(collectAppliedSettingIds(messages)).toEqual(['applied-1', 'interface.font:7'])
    expect(collectAppliedSettingIds(undefined)).toEqual([])
  })
})
