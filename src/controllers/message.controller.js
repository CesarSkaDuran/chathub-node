import db from '../db/knex.js'
import { sendWhatsApp, verifyNumber, getSessionStatus } from '../services/whatsapp.service.js'
import { resolveOutboundTarget } from '../utils/whatsapp-contact.js'

export async function history(req, res) {
  const { page = 1, limit = 50 } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  const messages = await db('messages as m')
    .leftJoin('users as u', 'm.sender_user_id', 'u.id')
    .select('m.*', 'u.name as sender_name')
    .where('m.conversation_id', req.params.id)
    .orderBy('m.created_at', 'asc')
    .limit(Number(limit))
    .offset(offset)

  const [{ total }] = await db('messages').where('conversation_id', req.params.id).count('id as total')

  res.json({ data: messages, total: Number(total), page: Number(page), limit: Number(limit) })
}

export async function send(req, res) {
  const { type = 'text', body, media_url } = req.body
  const convId = Number(req.params.id)

  if (!type) return res.status(400).json({ error: 'type requerido' })
  if (type === 'text' && !body) return res.status(400).json({ error: 'body requerido para mensajes de texto' })

  const conv = await db('conversations as c')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .select('c.id', 'c.channel_id', 'c.contact_id',
            'ch.type as channel_type', 'ch.session_id', 'ch.status as channel_status',
            'ct.phone', 'ct.meta as contact_meta', 'ct.email as contact_email', 'ct.instagram_handle')
    .where('c.id', convId)
    .first()

  if (!conv) return res.status(404).json({ error: 'Conversacion no encontrada' })

  const [msgId] = await db('messages').insert({
    conversation_id: convId,
    sender_user_id:  req.user.id,
    direction:       'outbound',
    type,
    body:            body || null,
    media_url:       media_url || null,
    status:          'sent',
    created_at:      new Date(),
    updated_at:      new Date(),
  })

  await db('conversations').where('id', convId).update({
    last_message_at: new Date(),
    updated_at:      new Date(),
  })

  if (conv.channel_type === 'whatsapp' && conv.session_id) {
    const sessionActive = getSessionStatus()[conv.session_id]

    if (sessionActive !== 'active') {
      await db('messages').where('id', msgId).update({ status: 'failed' })
      return res.status(400).json({ error: 'El canal de WhatsApp no está conectado' })
    }

    const resolved = resolveOutboundTarget(conv.phone, conv.contact_meta)
    if (!resolved) {
      await db('messages').where('id', msgId).update({ status: 'failed' })
      return res.status(400).json({ error: 'No se pudo determinar el destino del contacto' })
    }

    let sendTarget = resolved.target

    try {
      if (resolved.kind === 'phone') {
        const check = await verifyNumber(conv.session_id, resolved.target)
        if (!check.exists || !check.jid) {
          await db('messages').where('id', msgId).update({ status: 'failed' })
          return res.status(400).json({
            error: `El número ${resolved.target} no tiene WhatsApp o es inválido`,
          })
        }
        sendTarget = check.jid
      } else {
        const check = await verifyNumber(conv.session_id, resolved.target)
        if (check.jid) sendTarget = check.jid
      }

      const extId = await sendWhatsApp(conv.session_id, sendTarget, { type, body, media_url })
      if (extId) {
        await db('messages').where('id', msgId).update({
          external_id: extId,
          status:      'sent',
          updated_at:  new Date(),
        })
      }
    } catch (err) {
      console.error('[Message] Error enviando WhatsApp:', err.message)
      await db('messages').where('id', msgId).update({ status: 'failed', updated_at: new Date() })
      return res.status(502).json({ error: 'No se pudo enviar el mensaje por WhatsApp' })
    }
  } else if (conv.channel_type === 'email' || conv.channel_type === 'webchat') {
    await db('messages').where('id', msgId).update({ status: 'failed' })
  }

  const message = await db('messages').where('id', msgId).first()

  req.io.to(`conv_${convId}`).emit('message:new', {
    ...message,
    sender_name: req.user.name,
  })

  // Notificar a la lista de conversaciones para actualización en tiempo real
  req.io.to(`branch_${conv.branch_id}`).emit('conversation:updated', {
    id: convId,
    last_message_at: new Date(),
    last_message: { body, type, direction: 'outbound' },
  })

  res.status(201).json(message)
}

export async function updateStatus(req, res) {
  const { external_id, status } = req.body
  if (!external_id || !status) return res.status(400).json({ error: 'external_id y status requeridos' })

  const updated = await db('messages').where('external_id', external_id).update({
    status,
    read_at: status === 'read' ? new Date() : null,
    updated_at: new Date(),
  })

  res.json({ updated: updated > 0 })
}
