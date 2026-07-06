import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  const handlers = {}
  const sock = {
    ev: { on: vi.fn((event, cb) => { handlers[event] = cb }) },
    sendMessage: vi.fn(),
    end: vi.fn(),
  }
  return { handlers, sock }
})

vi.mock('@whiskeysockets/baileys', () => ({
  makeWASocket: vi.fn(() => h.sock),
  useMultiFileAuthState: vi.fn(async () => ({ state: { creds: {}, keys: {} }, saveCreds: vi.fn() })),
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 3000, 1] })),
  makeCacheableSignalKeyStore: vi.fn(() => ({})),
  DisconnectReason: { loggedOut: 401 },
}))
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,QR') }))
vi.mock('pino', () => ({ default: vi.fn(() => ({ level: 'silent' })) }))
vi.mock('fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})
vi.mock('../../src/services/inbound.service.js', () => ({ processInboundMessage: vi.fn() }))

import { toDataURL } from 'qrcode'
import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeIo } from '../helpers/dbMock.js'
import { processInboundMessage } from '../../src/services/inbound.service.js'
import {
  startSession, stopSession, sendWhatsApp, getSessionStatus, restoreAllSessions,
} from '../../src/services/whatsapp.service.js'

beforeEach(() => {
  resetDbMock(db)
  h.sock.sendMessage.mockReset()
  toDataURL.mockClear()
  processInboundMessage.mockReset()
})

afterEach(async () => {
  // Sessions live in a module-level Map; clean up so tests stay independent.
  await stopSession('session_test')
})

async function startActive(channelId = 1) {
  const channel = { id: channelId, session_id: 'session_test' }
  const io = makeIo()
  await startSession(channel, io)
  await h.handlers['connection.update']({ connection: 'open' })
  return io
}

describe('startSession', () => {
  it('emits the QR code and stores it when a qr is received', async () => {
    const io = makeIo()
    await startSession({ id: 1, session_id: 'session_test' }, io)

    await h.handlers['connection.update']({ qr: 'raw-qr' })

    expect(toDataURL).toHaveBeenCalledWith('raw-qr')
    expect(db.__update).toHaveBeenCalledWith(expect.objectContaining({ status: 'connecting' }))
    expect(io.emit).toHaveBeenCalledWith('channel:qr', { channel_id: 1, qr: 'data:image/png;base64,QR' })
  })

  it('marks the channel active when the connection opens', async () => {
    const io = await startActive(1)
    expect(getSessionStatus().session_test).toBe('active')
    expect(io.emit).toHaveBeenCalledWith('channel:status', { channel_id: 1, status: 'active' })
    expect(db.__update).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  })

  it('removes the session without reconnecting after a logout close', async () => {
    const io = makeIo()
    await startSession({ id: 1, session_id: 'session_test' }, io)
    await h.handlers['connection.update']({
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    })
    expect(io.emit).toHaveBeenCalledWith('channel:status', { channel_id: 1, status: 'error' })
    expect(getSessionStatus().session_test).toBeUndefined()
  })
})

describe('sendWhatsApp', () => {
  it('throws when the session is not active', async () => {
    await expect(sendWhatsApp('missing_session', '573001', { type: 'text', body: 'hi' }))
      .rejects.toThrow(/no activa/)
  })

  it('sends a text message and returns the external id', async () => {
    await startActive()
    h.sock.sendMessage.mockResolvedValueOnce({ key: { id: 'MID-1' } })

    const extId = await sendWhatsApp('session_test', '573001', { type: 'text', body: 'hola' })

    expect(h.sock.sendMessage).toHaveBeenCalledWith('573001@s.whatsapp.net', { text: 'hola' })
    expect(extId).toBe('MID-1')
  })

  it('builds image content and keeps an already-qualified jid', async () => {
    await startActive()
    h.sock.sendMessage.mockResolvedValueOnce({ key: { id: 'MID-2' } })

    await sendWhatsApp('session_test', '573001@s.whatsapp.net', {
      type: 'image', body: 'caption', media_url: 'http://img/x.jpg',
    })

    expect(h.sock.sendMessage).toHaveBeenCalledWith(
      '573001@s.whatsapp.net',
      { image: { url: 'http://img/x.jpg' }, caption: 'caption' },
    )
  })

  it('returns null when the result has no key id', async () => {
    await startActive()
    h.sock.sendMessage.mockResolvedValueOnce({})
    const extId = await sendWhatsApp('session_test', '573001', { type: 'text', body: 'hi' })
    expect(extId).toBeNull()
  })
})

describe('messages.upsert handler', () => {
  it('parses text and image messages and ignores groups and own messages', async () => {
    await startActive()

    await h.handlers['messages.upsert']({
      type: 'notify',
      messages: [
        { key: { fromMe: true, remoteJid: '573@s.whatsapp.net', id: 'a' }, message: { conversation: 'mine' } },
        { key: { fromMe: false, remoteJid: '999@g.us', id: 'b' }, message: { conversation: 'group' } },
        { key: { fromMe: false, remoteJid: '573001@s.whatsapp.net', id: 'c' }, pushName: 'Ana', message: { conversation: 'hola' } },
        { key: { fromMe: false, remoteJid: '573002@s.whatsapp.net', id: 'd' }, message: { imageMessage: { caption: 'foto', mimetype: 'image/jpeg' } } },
      ],
    })

    expect(processInboundMessage).toHaveBeenCalledTimes(2)
    expect(processInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ external_id: 'c', from_phone: '573001', from_name: 'Ana', type: 'text', body: 'hola' }),
      expect.anything(),
    )
    expect(processInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ external_id: 'd', from_phone: '573002', type: 'image', body: 'foto', media_mime_type: 'image/jpeg' }),
      expect.anything(),
    )
  })

  it('ignores upserts that are not of type notify', async () => {
    await startActive()
    await h.handlers['messages.upsert']({ type: 'append', messages: [] })
    expect(processInboundMessage).not.toHaveBeenCalled()
  })
})

describe('message-receipt.update handler', () => {
  it('updates message status to read when a read timestamp is present', async () => {
    await startActive()
    await h.handlers['message-receipt.update']([
      { key: { id: 'ext-1' }, receipt: { readTimestamp: 12345 } },
    ])
    expect(db.__update).toHaveBeenCalledWith(expect.objectContaining({ status: 'read' }))
  })
})

describe('getSessionStatus', () => {
  it('reports the status keyed by session id', async () => {
    await startActive()
    expect(getSessionStatus()).toMatchObject({ session_test: 'active' })
  })
})

describe('restoreAllSessions', () => {
  it('starts a session for each stored whatsapp channel', async () => {
    db.__rows.mockReturnValue([{ id: 1, session_id: 'session_test', type: 'whatsapp' }])
    await restoreAllSessions(makeIo())
    expect(getSessionStatus()).toHaveProperty('session_test')
  })
})
