import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})

import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeIo } from '../helpers/dbMock.js'
import { processInboundMessage } from '../../src/services/inbound.service.js'

beforeEach(() => resetDbMock(db))

const waChannel = { id: 1, type: 'whatsapp' }

describe('processInboundMessage', () => {
  it('creates a message for an existing contact/conversation and emits events', async () => {
    const contact = { id: 7, name: 'Ana', phone: '573001' }
    const conversation = { id: 3, status: 'open', unread_count: 1 }
    const message = { id: 55, body: 'hola', direction: 'inbound' }
    const channelFull = { id: 1, branch_id: 2 }

    db.__first
      .mockResolvedValueOnce(contact)       // resolveContact
      .mockResolvedValueOnce(conversation)  // resolveConversation
      .mockResolvedValueOnce(undefined)     // dedup check (no existing external_id)
      .mockResolvedValueOnce(message)        // reload inserted message
      .mockResolvedValueOnce(channelFull)    // channel for branch room
    db.__insert.mockResolvedValueOnce([55])

    const io = makeIo()
    const result = await processInboundMessage(waChannel, {
      external_id: 'wa-1', from_phone: '573001', from_name: 'Ana', type: 'text', body: 'hola',
    }, io)

    expect(db.__insert).toHaveBeenCalledWith(expect.objectContaining({
      conversation_id: 3, direction: 'inbound', type: 'text', body: 'hola', external_id: 'wa-1',
    }))
    expect(io.to).toHaveBeenCalledWith('conv_3')
    expect(io.to).toHaveBeenCalledWith('branch_2')
    expect(io.emit).toHaveBeenCalledWith('message:new', expect.objectContaining({
      id: 55, contact: { id: 7, name: 'Ana', phone: '573001' },
    }))
    expect(io.emit).toHaveBeenCalledWith('conversation:updated', expect.objectContaining({
      id: 3, unread_count: 2,
    }))
    expect(result).toEqual(message)
  })

  it('returns the existing message and skips insert on a duplicate external_id', async () => {
    const existing = { id: 99, external_id: 'wa-dup' }
    db.__first
      .mockResolvedValueOnce({ id: 7, name: 'Ana', phone: '573001' }) // contact
      .mockResolvedValueOnce({ id: 3, status: 'open', unread_count: 0 }) // conversation
      .mockResolvedValueOnce(existing) // dedup hit

    const io = makeIo()
    const result = await processInboundMessage(waChannel, {
      external_id: 'wa-dup', from_phone: '573001', type: 'text', body: 'again',
    }, io)

    expect(result).toEqual(existing)
    expect(db.__insert).not.toHaveBeenCalled()
    expect(io.emit).not.toHaveBeenCalled()
  })

  it('creates a new contact when none exists', async () => {
    db.__first
      .mockResolvedValueOnce(undefined)                              // contact lookup: none
      .mockResolvedValueOnce({ id: 12, name: 'Nuevo', phone: '573002' }) // reload created contact
      .mockResolvedValueOnce({ id: 4, status: 'pending', unread_count: 0 }) // conversation
      .mockResolvedValueOnce(undefined)                              // dedup
      .mockResolvedValueOnce({ id: 60 })                             // reload message
      .mockResolvedValueOnce({ id: 1, branch_id: 5 })                // channel
    db.__insert
      .mockResolvedValueOnce([12]) // insert contact
      .mockResolvedValueOnce([60]) // insert message

    const io = makeIo()
    await processInboundMessage(waChannel, {
      external_id: 'wa-3', from_phone: '573002', from_name: 'Nuevo', type: 'text', body: 'hey',
    }, io)

    // First insert is the new contact.
    expect(db.__insert.mock.calls[0][0]).toMatchObject({ phone: '573002', name: 'Nuevo' })
  })

  it('resolves an email contact by address, creating it when missing', async () => {
    db.__first
      .mockResolvedValueOnce(undefined)                                 // email contact lookup
      .mockResolvedValueOnce({ id: 20, name: 'Cliente', email: 'c@x.com' }) // reload
      .mockResolvedValueOnce({ id: 8, status: 'open', unread_count: 0 })    // conversation
      .mockResolvedValueOnce(undefined)                                  // dedup
      .mockResolvedValueOnce({ id: 70 })                                 // message
      .mockResolvedValueOnce({ id: 2, branch_id: 3 })                    // channel
    db.__insert.mockResolvedValueOnce([20]).mockResolvedValueOnce([70])

    await processInboundMessage({ id: 2, type: 'email' }, {
      external_id: 'em-1', from_email: 'c@x.com', from_name: 'Cliente', type: 'text', body: 'hi',
    }, makeIo())

    expect(db.__insert.mock.calls[0][0]).toMatchObject({ email: 'c@x.com', name: 'Cliente' })
  })

  it('resolves an instagram contact by handle', async () => {
    db.__first
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 30, instagram_handle: '@user' })
      .mockResolvedValueOnce({ id: 9, status: 'open', unread_count: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 80 })
      .mockResolvedValueOnce({ id: 3, branch_id: 1 })
    db.__insert.mockResolvedValueOnce([30]).mockResolvedValueOnce([80])

    await processInboundMessage({ id: 3, type: 'instagram' }, {
      external_id: 'ig-1', from_handle: '@user', type: 'text', body: 'hi',
    }, makeIo())

    expect(db.__insert.mock.calls[0][0]).toMatchObject({ instagram_handle: '@user' })
  })

  it('creates a new conversation for a webchat visitor when none is open', async () => {
    db.__first
      .mockResolvedValueOnce(undefined)                       // webchat contact lookup
      .mockResolvedValueOnce({ id: 40, name: 'Visitante Web' }) // reload contact
      .mockResolvedValueOnce(undefined)                       // no open conversation
      .mockResolvedValueOnce({ id: 11, status: 'pending', unread_count: 0 }) // reload conversation
      .mockResolvedValueOnce(undefined)                       // dedup
      .mockResolvedValueOnce({ id: 90 })                      // message
      .mockResolvedValueOnce({ id: 4, branch_id: 1 })         // channel
    db.__insert
      .mockResolvedValueOnce([40]) // contact
      .mockResolvedValueOnce([11]) // conversation
      .mockResolvedValueOnce([90]) // message

    await processInboundMessage({ id: 4, type: 'webchat' }, {
      from: 'web_abc', type: 'text', body: 'hola',
    }, makeIo())

    expect(db.__insert.mock.calls[0][0]).toMatchObject({ phone: 'web_abc', name: 'Visitante Web' })
    expect(db.__insert.mock.calls[1][0]).toMatchObject({ channel_id: 4, contact_id: 40, status: 'pending' })
  })

  it('swallows errors and returns undefined', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.__first.mockRejectedValueOnce(new Error('db down'))

    const result = await processInboundMessage(waChannel, {
      from_phone: '573001', type: 'text', body: 'x',
    }, makeIo())

    expect(result).toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
