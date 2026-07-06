import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})
vi.mock('../../src/services/whatsapp.service.js', () => ({
  sendWhatsApp: vi.fn(),
}))

import { sendWhatsApp } from '../../src/services/whatsapp.service.js'
import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeRes, makeIo } from '../helpers/dbMock.js'
import { history, send, updateStatus } from '../../src/controllers/message.controller.js'

beforeEach(() => {
  resetDbMock(db)
  sendWhatsApp.mockReset()
})

describe('history', () => {
  it('returns messages plus total and pagination', async () => {
    const messages = [{ id: 1, body: 'hola' }, { id: 2, body: 'que tal' }]
    db.__rows.mockReturnValue(messages)
    db.__count.mockReturnValue([{ total: 2 }])

    const res = makeRes()
    await history({ params: { id: 1 }, query: { page: 1, limit: 50 } }, res)

    expect(res.body).toEqual({ data: messages, total: 2, page: 1, limit: 50 })
  })
})

describe('send', () => {
  it('returns 400 when a text message has no body', async () => {
    const res = makeRes()
    await send({ params: { id: 1 }, body: { type: 'text' }, user: { id: 1 } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.body).toEqual({ error: 'body requerido para mensajes de texto' })
  })

  it('returns 404 when the conversation is not found', async () => {
    db.__first.mockResolvedValueOnce(undefined)
    const res = makeRes()
    await send({ params: { id: 1 }, body: { type: 'text', body: 'hi' }, user: { id: 1 } }, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('persists the message, emits it and does not send whatsapp for a webchat channel', async () => {
    const conv = { id: 1, channel_id: 2, contact_id: 3, channel_type: 'webchat', session_id: null, phone: null }
    const message = { id: 55, body: 'hi', direction: 'outbound' }
    db.__first
      .mockResolvedValueOnce(conv)      // conversation lookup
      .mockResolvedValueOnce(message)   // reload inserted message
    db.__insert.mockResolvedValueOnce([55])

    const io = makeIo()
    const res = makeRes()
    await send({ params: { id: 1 }, body: { type: 'text', body: 'hi' }, user: { id: 1, name: 'Ana' }, io }, res)

    expect(db.__insert).toHaveBeenCalledWith(expect.objectContaining({
      conversation_id: 1, sender_user_id: 1, direction: 'outbound', type: 'text', body: 'hi', status: 'sent',
    }))
    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(io.to).toHaveBeenCalledWith('conv_1')
    expect(io.emit).toHaveBeenCalledWith('message:new', expect.objectContaining({ id: 55, sender_name: 'Ana' }))
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.body).toEqual(message)
  })

  it('dispatches through whatsapp when the channel is whatsapp with a session', async () => {
    const conv = { id: 1, channel_id: 2, contact_id: 3, channel_type: 'whatsapp', session_id: 'session_x', phone: '573001' }
    db.__first
      .mockResolvedValueOnce(conv)
      .mockResolvedValueOnce({ id: 55 })
    db.__insert.mockResolvedValueOnce([55])
    sendWhatsApp.mockResolvedValueOnce('ext-123')

    const io = makeIo()
    const res = makeRes()
    await send({ params: { id: 1 }, body: { type: 'text', body: 'hi' }, user: { id: 1, name: 'Ana' }, io }, res)

    expect(sendWhatsApp).toHaveBeenCalledWith('session_x', '573001', { type: 'text', body: 'hi', media_url: undefined })
  })
})

describe('updateStatus', () => {
  it('returns 400 when external_id or status is missing', async () => {
    const res = makeRes()
    await updateStatus({ body: { status: 'read' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('reports updated=true when a row was affected', async () => {
    db.__update.mockResolvedValueOnce(1)
    const res = makeRes()
    await updateStatus({ body: { external_id: 'abc', status: 'read' } }, res)
    expect(res.body).toEqual({ updated: true })
  })

  it('reports updated=false when no row matched', async () => {
    db.__update.mockResolvedValueOnce(0)
    const res = makeRes()
    await updateStatus({ body: { external_id: 'abc', status: 'delivered' } }, res)
    expect(res.body).toEqual({ updated: false })
  })
})
