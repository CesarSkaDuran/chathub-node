import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})
vi.mock('../../src/services/whatsapp.service.js', () => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
}))

import { startSession, stopSession } from '../../src/services/whatsapp.service.js'
import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeRes } from '../helpers/dbMock.js'
import { list, create, remove, reconnect, getQr } from '../../src/controllers/channel.controller.js'

beforeEach(() => {
  resetDbMock(db)
  startSession.mockReset()
  stopSession.mockReset()
})

describe('list', () => {
  it('returns channels ordered by creation date', async () => {
    const rows = [{ id: 1, name: 'WA Norte' }]
    db.__rows.mockReturnValue(rows)
    const res = makeRes()
    await list({ user: { role: 'admin' }, query: {} }, res)
    expect(res.body).toEqual(rows)
  })
})

describe('create', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = makeRes()
    await create({ body: { name: 'x' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates a whatsapp channel and starts a session', async () => {
    const channel = { id: 5, type: 'whatsapp', session_id: 'session_573001234567' }
    db.__insert.mockResolvedValueOnce([5])
    db.__first.mockResolvedValueOnce(channel)
    const io = {}
    const res = makeRes()

    await create({
      body: { branch_id: 1, type: 'whatsapp', name: 'WA', identifier: '573001234567' },
      io,
    }, res)

    expect(db.__insert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'whatsapp', session_id: 'session_573001234567', status: 'inactive',
    }))
    expect(startSession).toHaveBeenCalledWith(channel, io)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.body).toEqual(channel)
  })

  it('does not start a session for non-whatsapp channels', async () => {
    const channel = { id: 6, type: 'email', session_id: null }
    db.__insert.mockResolvedValueOnce([6])
    db.__first.mockResolvedValueOnce(channel)
    const res = makeRes()

    await create({
      body: { branch_id: 1, type: 'email', name: 'Correo', identifier: 'info@x.com' },
      io: {},
    }, res)

    expect(db.__insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: null }))
    expect(startSession).not.toHaveBeenCalled()
  })
})

describe('remove', () => {
  it('returns 404 when the channel is not found', async () => {
    db.__first.mockResolvedValueOnce(undefined)
    const res = makeRes()
    await remove({ params: { id: 1 } }, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('stops the whatsapp session and deletes the channel', async () => {
    db.__first.mockResolvedValueOnce({ id: 2, type: 'whatsapp', session_id: 'session_x' })
    const res = makeRes()
    await remove({ params: { id: 2 } }, res)
    expect(stopSession).toHaveBeenCalledWith('session_x')
    expect(db.__del).toHaveBeenCalled()
    expect(res.body).toEqual({ deleted: true })
  })
})

describe('reconnect', () => {
  it('returns 404 when the channel is not found', async () => {
    db.__first.mockResolvedValueOnce(undefined)
    const res = makeRes()
    await reconnect({ params: { id: 1 } }, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns 400 for a non-whatsapp channel', async () => {
    db.__first.mockResolvedValueOnce({ id: 3, type: 'email' })
    const res = makeRes()
    await reconnect({ params: { id: 3 } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.body).toEqual({ error: 'Solo para canales WhatsApp' })
  })

  it('sets status to connecting and restarts the session', async () => {
    const channel = { id: 4, type: 'whatsapp', session_id: 'session_y' }
    db.__first.mockResolvedValueOnce(channel)
    const io = {}
    const res = makeRes()

    await reconnect({ params: { id: 4 }, io }, res)

    expect(db.__update).toHaveBeenCalledWith(expect.objectContaining({ status: 'connecting' }))
    expect(startSession).toHaveBeenCalledWith(channel, io)
    expect(res.body).toEqual({ message: 'Reconexion iniciada' })
  })
})

describe('getQr', () => {
  it('returns 404 when the channel is not found', async () => {
    db.__first.mockResolvedValueOnce(undefined)
    const res = makeRes()
    await getQr({ params: { id: 1 } }, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('parses the stored meta and returns the qr', async () => {
    db.__first.mockResolvedValueOnce({
      status: 'connecting',
      meta: JSON.stringify({ qr: 'data:image/png;base64,abc' }),
    })
    const res = makeRes()
    await getQr({ params: { id: 2 } }, res)
    expect(res.body).toEqual({ status: 'connecting', qr: 'data:image/png;base64,abc' })
  })

  it('returns a null qr when meta is absent', async () => {
    db.__first.mockResolvedValueOnce({ status: 'active', meta: null })
    const res = makeRes()
    await getQr({ params: { id: 3 } }, res)
    expect(res.body).toEqual({ status: 'active', qr: null })
  })
})
