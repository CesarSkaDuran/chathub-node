import db from '../db/knex.js'
import { parseContactMeta } from '../utils/whatsapp-contact.js'

/**
 * Procesa un mensaje entrante de cualquier canal.
 * Crea el contacto, conversacion y mensaje si no existen.
 * Emite el evento via Socket.io.
 */
export async function processInboundMessage(channel, payload, io) {
  try {
    // 1. Resolver contacto
    const contact = await resolveContact(channel.type, payload)

    // Si el contacto es null (ID interno ignorado), no procesar el mensaje
    if (!contact) {
      console.log(`[InboundService] Contacto ignorado (sin identificador utilizable) - no se procesa mensaje`)
      return null
    }

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
      meta:            (payload.participant_name || payload.participant_jid)
        ? JSON.stringify({
            ...(payload.participant_name ? { participant_name: payload.participant_name } : {}),
            ...(payload.participant_jid ? { participant_jid: payload.participant_jid } : {}),
          })
        : null,
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
    const branchId = channelFull?.branch_id || null

    const rooms = [`conv_${conversation.id}`]
    if (branchId) rooms.push(`branch_${branchId}`)
    rooms.push('all_branches')

    io.to(rooms).emit('message:new', {
      ...message,
      contact: { id: contact.id, name: contact.name, phone: contact.phone },
    })

    const convRooms = branchId ? [`branch_${branchId}`, 'all_branches'] : ['all_branches']
    io.to(convRooms).emit('conversation:updated', {
      id:              conversation.id,
      unread_count:    conversation.unread_count + 1,
      last_message_at: new Date(),
      last_message:    { body: payload.body, type: payload.type, direction: 'inbound' },
    })

    return message
  } catch (err) {
    console.error('[InboundService] Error procesando mensaje:', err.message)
  }
}

/**
 * Extrae el numero de LID crudo (solo digitos) de un jid tipo "123456789@lid".
 * Devuelve null si no es un LID.
 */
function extractLid(value) {
  if (!value) return null
  const str = String(value)
  if (!str.includes('@lid')) return null
  const digits = str.split('@')[0]
  return /^\d+$/.test(digits) ? digits : null
}

/**
 * Busca un contacto existente por LID usando la columna whatsapp_lid dedicada.
 */
async function findContactByLid(lid) {
  if (!lid) return null
  return db('contacts').where('whatsapp_lid', lid).first()
}

async function resolveContact(channelType, payload) {
  switch (channelType) {
    case 'whatsapp': {
      if (payload.is_group) {
        const groupJid = payload.group_jid
        let contact = await db('contacts').where('phone', groupJid).first()

        if (!contact) {
          const [id] = await db('contacts').insert({
            phone: groupJid,
            name: payload.group_name || groupJid,
            is_group: true,
            created_at: new Date(),
            updated_at: new Date(),
          })
          contact = await db('contacts').where('id', id).first()
        } else if (payload.group_name && contact.name !== payload.group_name) {
          await db('contacts').where('id', contact.id).update({
            name: payload.group_name,
            updated_at: new Date(),
          })
          contact = { ...contact, name: payload.group_name }
        }

        return contact
      }

      const jid = payload.from_jid || null
      // from_phone solo debe traer un numero real; whatsapp.service.js ya no debe
      // rellenarlo con LIDs. Si igual llega algo con @lid, lo tratamos como "sin telefono".
      const phone = payload.from_phone && !String(payload.from_phone).includes('@lid')
        ? payload.from_phone
        : null

      // El LID puede venir explicito (payload.lid) o embebido en jid/address_key
      const lid = payload.lid
        || extractLid(payload.address_key)
        || extractLid(jid)
        || (payload.is_lid_only ? extractLid(payload.address_key) : null)

      if (!phone && !lid) {
        console.log('[Inbound] Sin telefono ni LID utilizable, mensaje ignorado')
        return null
      }

      console.log(
        `[Inbound] Contacto - jid: ${jid}, phone: ${phone || '(sin resolver)'}, lid: ${lid || '(n/a)'}`,
      )

      const metaPatch = {}
      if (jid) metaPatch.whatsapp_jid = jid
      if (lid) metaPatch.whatsapp_lid = lid

      let contact = null

      // 1. Si tenemos telefono real, esa es la clave primaria de busqueda/creacion
      if (phone) {
        contact = await db('contacts').where('phone', phone).first()

        // Si no existe por telefono, puede que ya exista por LID (mismo contacto
        // que antes solo conociamos por LID y ahora comparte su numero real)
        if (!contact && lid) {
          contact = await findContactByLid(lid)
        }

        if (!contact) {
          const displayName = payload.from_name || phone
          const [id] = await db('contacts').insert({
            phone,
            name: displayName,
            whatsapp_lid: lid || null,
            meta: Object.keys(metaPatch).length ? JSON.stringify(metaPatch) : null,
            created_at: new Date(),
            updated_at: new Date(),
          })
          contact = await db('contacts').where('id', id).first()
        } else {
          const updates = {}
          const existingMeta = parseContactMeta(contact.meta)

          if (payload.from_name && (!contact.name || contact.name === contact.phone)) {
            updates.name = payload.from_name
          }

          // Completar el telefono real si el contacto solo tenia LID
          if (!contact.phone || contact.phone !== phone) {
            updates.phone = phone
          }

          // Mantener whatsapp_lid en columna dedicada
          if (lid && !contact.whatsapp_lid) {
            updates.whatsapp_lid = lid
          }

          const mergedMeta = { ...existingMeta, ...metaPatch }
          if (JSON.stringify(mergedMeta) !== JSON.stringify(existingMeta)) {
            updates.meta = JSON.stringify(mergedMeta)
          }

          if (Object.keys(updates).length) {
            updates.updated_at = new Date()
            await db('contacts').where('id', contact.id).update(updates)
            contact = { ...contact, ...updates }
          }
        }
      } else {
        // 2. Solo tenemos LID: NO lo guardamos en la columna `phone`.
        //    Buscamos/creamos el contacto usando el LID como identificador en meta.
        contact = await findContactByLid(lid)

        if (!contact) {
          const displayName = payload.from_name || `WhatsApp ${lid}`
          const [id] = await db('contacts').insert({
            phone: null,
            name: displayName,
            whatsapp_lid: lid,
            meta: JSON.stringify(metaPatch),
            created_at: new Date(),
            updated_at: new Date(),
          })
          contact = await db('contacts').where('id', id).first()
        } else {
          const updates = {}
          const existingMeta = parseContactMeta(contact.meta)

          if (payload.from_name && (!contact.name || contact.name.startsWith('WhatsApp '))) {
            updates.name = payload.from_name
          }

          // Mantener whatsapp_lid en columna dedicada
          if (lid && !contact.whatsapp_lid) {
            updates.whatsapp_lid = lid
          }

          const mergedMeta = { ...existingMeta, ...metaPatch }
          if (JSON.stringify(mergedMeta) !== JSON.stringify(existingMeta)) {
            updates.meta = JSON.stringify(mergedMeta)
          }

          if (Object.keys(updates).length) {
            updates.updated_at = new Date()
            await db('contacts').where('id', contact.id).update(updates)
            contact = { ...contact, ...updates }
          }
        }
      }

      console.log(`[Inbound] Contacto resuelto - id: ${contact.id}, phone: ${contact.phone || '(solo LID)'}`)
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
  console.log(`[Inbound] resolveConversation - channelId: ${channelId}, contactId: ${contactId}`)

  // Cada canal tiene su propia conversación con el mismo contacto.
  // No reutilizar conversaciones de otros canales: si se reutiliza,
  // al responder se envía por el session_id del canal original y el
  // mensaje no llega desde el canal que recibió el inbound.
  let conv = await db('conversations')
    .where('channel_id', channelId)
    .where('contact_id', contactId)
    .orderBy('created_at', 'desc')
    .first()

  if (conv) {
    if (conv.status === 'resolved') {
      await db('conversations').where('id', conv.id).update({
        status: 'open',
        updated_at: new Date(),
      })
      conv.status = 'open'
    }
    console.log(`[Inbound] Conversación existente encontrada en este canal: ${conv.id}`)
    return conv
  }

  console.log(`[Inbound] Creando nueva conversación para canal ${channelId}`)
  const [id] = await db('conversations').insert({
    channel_id:  channelId,
    contact_id:  contactId,
    status:      'pending',
    unread_count: 0,
    created_at:  new Date(),
    updated_at:  new Date(),
  })
  conv = await db('conversations').where('id', id).first()
  return conv
}