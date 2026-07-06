import { describe, it, expect, vi } from 'vitest'

// The route module only wires controllers/middlewares together, so stub the
// data and side-effecting layers to keep the import lightweight.
vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})
vi.mock('../../src/services/whatsapp.service.js', () => ({
  startSession: vi.fn(), stopSession: vi.fn(), sendWhatsApp: vi.fn(),
}))

import router from '../../src/routes/index.js'

function registered() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`),
    )
}

describe('api router', () => {
  it('registers all documented endpoints', () => {
    const routes = registered()
    const expected = [
      'POST /auth/login',
      'POST /auth/logout',
      'GET /auth/me',
      'GET /dashboard/stats',
      'GET /conversations',
      'GET /conversations/:id',
      'PUT /conversations/:id/assign',
      'PUT /conversations/:id/status',
      'PUT /conversations/:id/read',
      'GET /conversations/:id/messages',
      'POST /conversations/:id/messages',
      'GET /channels',
      'POST /channels',
      'DELETE /channels/:id',
      'POST /channels/:id/reconnect',
      'GET /channels/:id/qr',
      'GET /agents',
      'POST /agents',
      'PUT /agents/:id',
      'POST /messages/status',
    ]
    for (const route of expected) {
      expect(routes).toContain(route)
    }
  })

  it('does not register unexpected extra routes', () => {
    expect(registered()).toHaveLength(20)
  })
})
