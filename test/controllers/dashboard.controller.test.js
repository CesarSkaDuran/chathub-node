import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})

import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeRes } from '../helpers/dbMock.js'
import { stats } from '../../src/controllers/dashboard.controller.js'

beforeEach(() => resetDbMock(db))

describe('stats', () => {
  it('aggregates counts and channel breakdown into numbers', async () => {
    const byChannel = [{ id: 1, name: 'WA', type: 'whatsapp', channel_status: 'active', open_count: 4 }]
    db.__count
      .mockReturnValueOnce([{ n: 5 }])   // open
      .mockReturnValueOnce([{ n: 2 }])   // pending
      .mockReturnValueOnce([{ n: 1 }])   // resolved today
      .mockReturnValueOnce([{ n: 3 }])   // unassigned
      .mockReturnValueOnce([{ n: 10 }])  // messages today
      .mockReturnValueOnce(byChannel)    // by-channel breakdown (count column)

    const res = makeRes()
    await stats({ user: { role: 'admin' } }, res)

    expect(res.body).toEqual({
      open: 5,
      pending: 2,
      resolved_today: 1,
      unassigned: 3,
      messages_today: 10,
      by_channel: byChannel,
    })
  })

  it('runs the branch-scoped variant for an agent', async () => {
    db.__count
      .mockReturnValueOnce([{ n: 0 }])
      .mockReturnValueOnce([{ n: 0 }])
      .mockReturnValueOnce([{ n: 0 }])
      .mockReturnValueOnce([{ n: 0 }])
      .mockReturnValueOnce([{ n: 0 }])
      .mockReturnValueOnce([]) // by-channel breakdown
    const res = makeRes()
    await stats({ user: { role: 'agent', branch_id: 3 } }, res)
    expect(res.body.open).toBe(0)
    expect(res.body.by_channel).toEqual([])
  })
})
