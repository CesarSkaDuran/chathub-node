import db from '../db/knex.js'

/**
 * Procesa un mensaje entrante de cualquier canal.
 * Crea el contacto, conversacion y mensaje si no existen.
 * Emite el evento via Socket.io.
 */
export async function processInboundMessage(channel, payload, io) {
  try {
    // 1. Resolver contacto
    const contact = await resolveContact(channel.type, payload)

    // 2. Resolver conversacion
    const conversation = await resolveConversation(channel.id, contact.id)

    // 3. Evitar duplicados
    if (payload.external_id) {
      const exists = await db('messages').where('external_id', payload.external_id).first()
      if (exists) return exists
    }

    // 4. Crear mensaje
    const [msgId] = await db('messages').insert({
      conversation_id: conversation.id,
      direction:       'inbound',
      type:            payload.type || 'text',
      body:            payload.body || null,
      external_id:     payload.external_id || null,
      media_url:       payload.media_url || null,
      media_mime_type: payload.media_mime_type || null,
      status:          'delivered',
      created_at:      new Date(),
      updated_at:      new Date(),
    })

    // 5. Actualizar conversacion
    await db('conversations').where('id', conversation.id).update({
      unread_count:    db.raw('unread_count + 1'),
      last_message_at: new Date(),
      status:          conversation.status === 'resolved' ? 'open' : conversation.status,
      updated_at:      new Date(),
    })

    const message = await db('messages').where('id', msgId).first()

    // 6. Emitir por Socket.io al room de la conversacion y al room de la sucursal
    const channelFull = await db('channels').where('id', channel.id).first()

    io.to(`conv_${conversation.id}`).emit('message:new', {
      ...message,
      contact: { id: contact.id, name: contact.name, phone: contact.phone },
    })

    io.to(`branch_${channelFull.branch_id}`).emit('conversation:updated', {
      id:              conversation.id,
      unread_count:    conversation.unread_count + 1,
      last_message_at: new Date(),
      last_message:    { body: payload.body, type: payload.type, direction: 'inbound' },
    })

    return message
  } catch (err) {
    // Registrar el error completo (con stack) para no perder contexto.
    // Se relanza para que el llamador decida como reaccionar en vez de
    // tragarse el fallo silenciosamente.
    console.error('[InboundService] Error procesando mensaje entrante:', err)
    throw err
  }
}

async function resolveContact(channelType, payload) {
  switch (channelType) {
    case 'whatsapp': {
      let contact = await db('contacts').where('phone', payload.from_phone).first()
      if (!contact) {
        const [id] = await db('contacts').insert({
          phone: payload.from_phone,
          name:  payload.from_name || payload.from_phone,
          created_at: new Date(), updated_at: new Date(),
        })
        contact = await db('contacts').where('id', id).first()
      } else if (payload.from_name && !contact.name) {
        await db('contacts').where('id', contact.id).update({ name: payload.from_name })
        contact.name = payload.from_name
      }
      return contact
    }
    case 'email': {
      let contact = await db('contacts').where('email', payload.from_email).first()
      if (!contact) {
        const [id] = await db('contacts').insert({
          email: payload.from_email,
          name:  payload.from_name || payload.from_email,
          created_at: new Date(), updated_at: new Date(),
        })
        contact = await db('contacts').where('id', id).first()
      }
      return contact
    }
    case 'instagram': {
      let contact = await db('contacts').where('instagram_handle', payload.from_handle).first()
      if (!contact) {
        const [id] = await db('contacts').insert({
          instagram_handle: payload.from_handle,
          name: payload.from_name || payload.from_handle,
          created_at: new Date(), updated_at: new Date(),
        })
        contact = await db('contacts').where('id', id).first()
      }
      return contact
    }
    default: {
      const identifier = payload.from || `webchat_${Date.now()}`
      let contact = await db('contacts').where('phone', identifier).first()
      if (!contact) {
        const [id] = await db('contacts').insert({
          phone: identifier, name: 'Visitante Web',
          created_at: new Date(), updated_at: new Date(),
        })
        contact = await db('contacts').where('id', id).first()
      }
      return contact
    }
  }
}

async function resolveConversation(channelId, contactId) {
  let conv = await db('conversations')
    .where('channel_id', channelId)
    .where('contact_id', contactId)
    .whereIn('status', ['open', 'pending'])
    .orderBy('created_at', 'desc')
    .first()

  if (!conv) {
    const [id] = await db('conversations').insert({
      channel_id:  channelId,
      contact_id:  contactId,
      status:      'pending',
      unread_count: 0,
      created_at:  new Date(),
      updated_at:  new Date(),
    })
    conv = await db('conversations').where('id', id).first()
  }

  return conv
}
