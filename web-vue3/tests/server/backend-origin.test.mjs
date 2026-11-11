import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBackendOrigin } from '../../scripts/backend-origin.mjs'

test('Vite backend origin shares the launcher and React environment contract', () => {
  assert.equal(resolveBackendOrigin({ DEEPTUTOR_API_ORIGIN: 'http://127.0.0.1:9000' }, { backend_port: 8001 }), 'http://127.0.0.1:9000')
  assert.equal(resolveBackendOrigin({ DEEPTUTOR_API_BASE_URL: 'http://127.0.0.1:9001' }, { backend_port: 8001 }), 'http://127.0.0.1:9001')
  assert.equal(resolveBackendOrigin({ BACKEND_PORT: '9002' }, {}), 'http://127.0.0.1:9002')
  assert.equal(resolveBackendOrigin({ NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:9003' }, {}), 'http://127.0.0.1:9003')
})

test('manual Vite startup follows the shared DeepTutor system settings', () => {
  assert.equal(resolveBackendOrigin({}, { next_public_api_base: 'http://backend.internal:8000' }), 'http://backend.internal:8000')
  assert.equal(resolveBackendOrigin({}, { backend_port: 8011 }), 'http://127.0.0.1:8011')
  assert.equal(resolveBackendOrigin({}, {}), 'http://127.0.0.1:8001')
})
