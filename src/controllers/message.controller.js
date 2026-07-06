import db from '../db/knex.js'
import { sendWhatsApp } from '../services/whatsapp.service.js'
import { loadAccessibleConversation } from '../utils/access.js'

export async function history(req, res) {
  const { page = 1, limit = 50 } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  const access = await loadAccessibleConversation(req.user, req.params.id)
  if (access.error) return res.status(access.error.status).json({ error: access.error.message })

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

  // Obtener conversacion con canal y contacto
  const conv = await db('conversations as c')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .select('c.id', 'c.channel_id', 'c.contact_id',
            'ch.type as channel_type', 'ch.session_id', 'ch.branch_id',
            'ct.phone', 'ct.email as contact_email', 'ct.instagram_handle')
    .where('c.id', convId)
    .first()

  if (!conv) return res.status(404).json({ error: 'Conversacion no encontrada' })

  // Agente: solo puede enviar en conversaciones de su sucursal
  if (req.user.role === 'agent' && conv.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Sin acceso a esta conversacion' })
  }

  // Guardar mensaje
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

  const message = await db('messages').where('id', msgId).first()

  // Enviar por el canal correspondiente.
  // El envio es fire-and-forget (ya respondimos 201), pero cada actualizacion
  // posterior del estado del mensaje debe esperarse y manejar sus propios
  // errores para no dejar promesas rechazadas sin capturar.
  if (conv.channel_type === 'whatsapp' && conv.session_id) {
    sendWhatsApp(conv.session_id, conv.phone, { type, body, media_url })
      .then(async extId => {
        if (extId) {
          await db('messages').where('id', msgId).update({ external_id: extId, status: 'delivered' })
        }
      })
      .catch(async err => {
        console.error('Error enviando WhatsApp:', err.message)
        try {
          await db('messages').where('id', msgId).update({ status: 'failed' })
        } catch (dbErr) {
          console.error('Error marcando mensaje como fallido:', dbErr.message)
        }
      })
  }

  // Emitir por Socket.io a la sala de la conversacion
  req.io.to(`conv_${convId}`).emit('message:new', {
    ...message,
    sender_name: req.user.name,
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
