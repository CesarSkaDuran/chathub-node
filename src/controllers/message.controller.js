import db from '../db/knex.js'
import { sendWhatsApp, verifyNumber, getSessionStatus } from '../services/whatsapp.service.js'
import { resolveOutboundTarget } from '../utils/whatsapp-contact.js'
import { deleteMedia, saveMedia } from '../utils/media.js'

const typeByMimePrefix = {
  image: 'image',
  audio: 'audio',
  video: 'video',
}

function inferType(mimetype) {
  const prefix = (mimetype || '').split('/')[0]
  return typeByMimePrefix[prefix] || 'document'
}

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

  const data = messages.map(m => {
    if (m.direction === 'inbound' && m.meta) {
      try {
        const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta
        if (meta?.participant_name) return { ...m, sender_name: meta.participant_name }
      } catch {}
    }
    return m
  })

  const [{ total }] = await db('messages').where('conversation_id', req.params.id).count('id as total')

  res.json({ data, total: Number(total), page: Number(page), limit: Number(limit) })
}

export async function send(req, res) {
  const { type = 'text', body, media_url } = req.body
  const convId = Number(req.params.id)

  if (!type) return res.status(400).json({ error: 'type requerido' })
  if (type === 'text' && !body) return res.status(400).json({ error: 'body requerido para mensajes de texto' })

  return sendMessageInternal(req, res, convId, { type, body, media_url })
}

export async function uploadAndSend(req, res) {
  const convId = Number(req.params.id)
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' })

  const type = inferType(req.file.mimetype)
  const body = req.body.caption || null

  let mediaUrl
  try {
    mediaUrl = await saveMedia(req.file.buffer, req.file.mimetype, type, 'send')
  } catch (err) {
    console.error('[Message] Error guardando archivo adjunto:', err.message)
    return res.status(500).json({ error: 'No se pudo guardar el archivo' })
  }

  return sendMessageInternal(req, res, convId, { type, body, media_url: mediaUrl })
}

async function sendMessageInternal(req, res, convId, { type, body, media_url }) {
  const conv = await db('conversations as c')
    .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .select('c.id', 'c.channel_id', 'c.contact_id',
            'ch.type as channel_type', 'ch.session_id', 'ch.status as channel_status', 'ch.branch_id',
            'ct.phone', 'ct.meta as contact_meta', 'ct.email as contact_email', 'ct.instagram_handle')
    .where('c.id', convId)
    .first()

  if (!conv) return res.status(404).json({ error: 'Conversacion no encontrada' })
  if (!conv.session_id) return res.status(400).json({ error: 'El canal de esta conversacion no esta conectado' })
  if (conv.channel_status !== 'active') return res.status(400).json({ error: 'El canal de WhatsApp no esta activo' })
  if (conv.channel_type !== 'whatsapp') return res.status(400).json({ error: 'Este canal no soporta envio de mensajes' })

  const sessionActive = getSessionStatus()[conv.session_id]
  if (sessionActive !== 'active') {
    return res.status(400).json({ error: 'El canal de WhatsApp no esta conectado' })
  }

  const resolved = resolveOutboundTarget(conv.phone, conv.contact_meta)
  if (!resolved) {
    return res.status(400).json({ error: 'No se pudo determinar el destino del contacto' })
  }

  // ── Guardar mensaje en DB con estado 'pending' y responder inmediatamente ──
  const [msgId] = await db('messages').insert({
    conversation_id: convId,
    sender_user_id:  req.user.id,
    direction:       'outbound',
    type,
    body:            body || null,
    media_url:       media_url || null,
    status:          'pending',
    created_at:      new Date(),
    updated_at:      new Date(),
  })

  await db('conversations').where('id', convId).update({
    last_message_at: new Date(),
    updated_at:      new Date(),
  })

  const message = await db('messages').where('id', msgId).first()

  // Emitir el mensaje inmediatamente al frontend (UI optimista)
  req.io.to(`conv_${convId}`).emit('message:new', {
    ...message,
    sender_name: req.user.name,
  })

  const branchRooms = conv.branch_id ? [`branch_${conv.branch_id}`, 'all_branches'] : ['all_branches']
  req.io.to(branchRooms).emit('conversation:updated', {
    id: convId,
    last_message_at: new Date(),
    last_message: { body, type, direction: 'outbound' },
  })

  // Responder al cliente AHORA — el envío a WhatsApp continúa en background
  res.status(201).json(message)

  // ── Envío a WhatsApp en segundo plano ──
  let sendTarget = resolved.target
  try {
    if (resolved.kind === 'phone') {
      const check = await verifyNumber(conv.session_id, resolved.target)
      if (!check.exists || !check.jid) {
        await db('messages').where('id', msgId).update({
          status: 'failed',
          updated_at: new Date(),
        })
        req.io.to(`conv_${convId}`).emit('message:status', {
          id: msgId, status: 'failed',
          error: `El numero ${resolved.target} no tiene WhatsApp o es invalido`,
        })
        return
      }
      sendTarget = check.jid
    } else {
      const check = await verifyNumber(conv.session_id, resolved.target)
      if (check.jid) sendTarget = check.jid
    }

    const extId = await sendWhatsApp(conv.session_id, sendTarget, { type, body, media_url })

    await db('messages').where('id', msgId).update({
      status: 'sent',
      external_id: extId,
      updated_at: new Date(),
    })

    req.io.to(`conv_${convId}`).emit('message:status', {
      id: msgId, status: 'sent', external_id: extId,
    })
  } catch (err) {
    console.error('[Message] Error enviando WhatsApp (background):', err.message)
    await db('messages').where('id', msgId).update({
      status: 'failed',
      updated_at: new Date(),
    })
    req.io.to(`conv_${convId}`).emit('message:status', {
      id: msgId, status: 'failed',
      error: 'No se pudo enviar el mensaje por WhatsApp',
    })
  }
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

export async function removeMedia(req, res) {
  const msg = await db('messages').where('id', req.params.id).first()
  if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' })

  if (msg.media_url) {
    await deleteMedia(msg.media_url)
  }

  await db('messages').where('id', msg.id).update({
    media_url: null,
    media_mime_type: null,
    updated_at: new Date(),
  })

  res.json({ success: true })
}
