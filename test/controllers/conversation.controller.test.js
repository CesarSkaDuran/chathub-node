import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})

import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeRes, makeIo } from '../helpers/dbMock.js'
import { list, show, assign, updateStatus, markRead } from '../../src/controllers/conversation.controller.js'

beforeEach(() => resetDbMock(db))

describe('list', () => {
  it('maps rows into the nested response shape and echoes pagination', async () => {
    const rows = [{
      id: 1, status: 'open', unread_count: 2, last_message_at: null, assigned_agent_id: 9,
      channel_id: 4, channel_type: 'whatsapp', channel_name: 'WA',
      contact_id: 7, contact_name: 'Ana', phone: '573001', contact_email: null,
      agent_id: 9, agent_name: 'Beto',
    }]
    db.__rows.mockReturnValue(rows)
    db.__count.mockReturnValue([{ total: 1 }])

    const res = makeRes()
    await list({ user: { role: 'admin' }, query: { page: 2, limit: 10 } }, res)

    expect(res.body.total).toBe(1)
    expect(res.body.page).toBe(2)
    expect(res.body.limit).toBe(10)
    expect(res.body.data[0]).toMatchObject({
      id: 1,
      channel: { id: 4, type: 'whatsapp', name: 'WA' },
      contact: { id: 7, name: 'Ana', phone: '573001', email: null },
      assigned_agent: { id: 9, name: 'Beto' },
    })
  })

  it('returns empty data without querying last messages when there are no rows', async () => {
    db.__rows.mockReturnValue([])
    db.__count.mockReturnValue([{ total: 0 }])
    const res = makeRes()
    await list({ user: { role: 'agent', branch_id: 1 }, query: {} }, res)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
  })
})

describe('show', () => {
  it('returns 404 when the conversation is not found', async () => {
    db.__first.mockResolvedValueOnce(undefined)
    const res = makeRes()
    await show({ params: { id: 1 }, user: { role: 'admin' } }, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns 403 when an agent accesses a conversation outside their branch', async () => {
    db.__first.mockResolvedValueOnce({ id: 1, branch_id: 5 })
    const res = makeRes()
    await show({ params: { id: 1 }, user: { role: 'agent', branch_id: 2 } }, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns the conversation for an authorized user', async () => {
    const conv = { id: 1, branch_id: 2, status: 'open' }
    db.__first.mockResolvedValueOnce(conv)
    const res = makeRes()
    await show({ params: { id: 1 }, user: { role: 'agent', branch_id: 2 } }, res)
    expect(res.body).toEqual(conv)
  })
})

describe('assign', () => {
  it('returns 400 when agent_id is missing', async () => {
    const res = makeRes()
    await assign({ params: { id: 1 }, body: {} }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('assigns the agent, emits an event and returns the conversation', async () => {
    const conv = { id: 1, channel_id: 4, assigned_agent_id: 9, status: 'open' }
    db.__first.mockResolvedValueOnce(conv)
    const io = makeIo()
    const res = makeRes()

    await assign({ params: { id: 1 }, body: { agent_id: 9 }, io }, res)

    expect(db.__update).toHaveBeenCalledWith(expect.objectContaining({ assigned_agent_id: 9, status: 'open' }))
    expect(io.to).toHaveBeenCalledWith('branch_4')
    expect(io.emit).toHaveBeenCalledWith('conversation:updated', conv)
    expect(res.body).toEqual(conv)
  })
})

describe('updateStatus', () => {
  it('returns 400 for an invalid status', async () => {
    const res = makeRes()
    await updateStatus({ params: { id: 1 }, body: { status: 'bogus' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('sets resolved_at when the status is resolved and emits an event', async () => {
    const conv = { id: 1, status: 'resolved' }
    db.__first.mockResolvedValueOnce(conv)
    const io = makeIo()
    const res = makeRes()

    await updateStatus({ params: { id: 1 }, body: { status: 'resolved' }, io }, res)

    const update = db.__update.mock.calls[0][0]
    expect(update).toMatchObject({ status: 'resolved' })
    expect(update).toHaveProperty('resolved_at')
    expect(io.to).toHaveBeenCalledWith('conv_1')
    expect(res.body).toEqual(conv)
  })

  it('does not set resolved_at for a non-resolved status', async () => {
    db.__first.mockResolvedValueOnce({ id: 1, status: 'pending' })
    const io = makeIo()
    const res = makeRes()
    await updateStatus({ params: { id: 1 }, body: { status: 'pending' }, io }, res)
    expect(db.__update.mock.calls[0][0]).not.toHaveProperty('resolved_at')
  })
})

describe('markRead', () => {
  it('resets unread_count and marks messages read', async () => {
    const res = makeRes()
    await markRead({ params: { id: 1 } }, res)
    expect(db.__update).toHaveBeenCalledTimes(2)
    expect(res.body).toEqual({ ok: true })
  })
})
