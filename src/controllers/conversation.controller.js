import db from '../db/knex.js'
import { markWhatsAppRead } from '../services/whatsapp.service.js'
import { parseContactMeta, resolveOutboundTarget } from '../utils/whatsapp-contact.js'
import { jidNormalizedUser } from '@whiskeysockets/baileys'

// Query base con joins
function convQuery(user) {
  let q = db('conversations as c')
    .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .leftJoin('users as ag', 'c.assigned_agent_id', 'ag.id')
    .select(
      'c.id', 'c.status', 'c.unread_count', 'c.last_message_at', 'c.assigned_agent_id',
      'ch.id as channel_id', 'ch.type as channel_type', 'ch.name as channel_name',
      'ch.branch_id as branch_id',
      'ct.id as contact_id', 'ct.name as contact_name', 'ct.phone', 'ct.email as contact_email',
      'ct.is_group as is_group',
      'ag.id as agent_id', 'ag.name as agent_name'
    )

  // Agente: solo su sucursal
  if (user.role === 'agent') {
    q = q.where('ch.branch_id', user.branch_id)
  }

  // Ocultar conversaciones cuyo canal ya no existe
  q = q.whereNotNull('ch.id')

  return q
}

export async function list(req, res) {
  const { status, channel_id, channel_type, branch_id, search, is_group, page = 1, limit = 25 } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  let q = convQuery(req.user)

  if (status)       q = q.where('c.status', status)
  if (channel_id)   q = q.where('c.channel_id', channel_id)
  if (channel_type) q = q.where('ch.type', channel_type)
  if (branch_id && req.user.role !== 'agent') q = q.where('ch.branch_id', branch_id)
  if (is_group !== undefined) q = q.where('ct.is_group', is_group === 'true' || is_group === '1')
  if (search) {
    q = q.where(function () {
      this.where('ct.name', 'like', `%${search}%`)
          .orWhere('ct.phone', 'like', `%${search}%`)
          .orWhere('ct.email', 'like', `%${search}%`)
    })
  }

  const [countRow] = await q.clone().count('c.id as total')
  const rows = await q.orderBy('c.last_message_at', 'desc').limit(Number(limit)).offset(offset)

  // Adjuntar ultimo mensaje
  const ids = rows.map(r => r.id)
  let lastMessages = []
  if (ids.length) {
    lastMessages = await db('messages')
      .whereIn('conversation_id', ids)
      .where('id', function () {
        this.max('id').from('messages as m2').whereRaw('m2.conversation_id = messages.conversation_id')
      })
      .select('conversation_id', 'body', 'type', 'direction')
  }
  const msgMap = Object.fromEntries(lastMessages.map(m => [m.conversation_id, m]))

  const data = rows.map(r => ({
    id:           r.id,
    status:       r.status,
    unread_count: r.unread_count,
    last_message_at: r.last_message_at,
    channel:      { id: r.channel_id, type: r.channel_type, name: r.channel_name },
    contact:      { id: r.contact_id, name: r.contact_name, phone: r.phone, email: r.contact_email, is_group: !!r.is_group },
    assigned_agent: r.agent_id ? { id: r.agent_id, name: r.agent_name } : null,
    last_message: msgMap[r.id] || null,
  }))

  res.json({ data, total: Number(countRow.total), page: Number(page), limit: Number(limit) })
}

/**
 * Contadores de conversaciones por canal (para pestañas del listado).
 * Devuelve total y no leídos por cada canal activo del usuario.
 */
export async function countsByChannel(req, res) {
  const { status, is_group, search } = req.query

  let q = db('conversations as c')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .whereNotNull('ch.id')
    .groupBy('ch.id', 'ch.name', 'ch.type', 'ch.status', 'ch.identifier')
    .select(
      'ch.id as channel_id',
      'ch.name as channel_name',
      'ch.type as channel_type',
      'ch.status as channel_status',
      'ch.identifier as channel_identifier',
      db.raw('COUNT(c.id) as total'),
      db.raw('COALESCE(SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END), 0) as with_unread'),
      db.raw('COALESCE(SUM(c.unread_count), 0) as unread_total'),
    )

  if (req.user.role === 'agent') {
    q = q.where('ch.branch_id', req.user.branch_id)
  }

  if (status) q = q.where('c.status', status)
  if (is_group !== undefined) q = q.where('ct.is_group', is_group === 'true' || is_group === '1')
  if (search) {
    q = q.where(function () {
      this.where('ct.name', 'like', `%${search}%`)
          .orWhere('ct.phone', 'like', `%${search}%`)
          .orWhere('ct.email', 'like', `%${search}%`)
    })
  }

  const rows = await q.orderBy('ch.name', 'asc')

  // Total global (todos los canales)
  const allTotal = rows.reduce((s, r) => s + Number(r.total), 0)
  const allUnread = rows.reduce((s, r) => s + Number(r.with_unread), 0)
  const allUnreadMsgs = rows.reduce((s, r) => s + Number(r.unread_total), 0)

  res.json({
    all: {
      total: allTotal,
      with_unread: allUnread,
      unread_total: allUnreadMsgs,
    },
    channels: rows.map(r => ({
      id: Number(r.channel_id),
      name: r.channel_name,
      type: r.channel_type,
      status: r.channel_status,
      identifier: r.channel_identifier,
      total: Number(r.total),
      with_unread: Number(r.with_unread),
      unread_total: Number(r.unread_total),
    })),
  })
}

export async function show(req, res) {
  const conv = await db('conversations as c')
    .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .leftJoin('users as ag', 'c.assigned_agent_id', 'ag.id')
    .select('c.*', 'ch.type as channel_type', 'ch.name as channel_name', 'ch.branch_id',
            'ct.name as contact_name', 'ct.phone', 'ct.email as contact_email', 'ct.is_group',
            'ag.name as agent_name')
    .where('c.id', req.params.id)
    .first()

  if (!conv) return res.status(404).json({ error: 'Conversacion no encontrada' })

  // Agente: validar su sucursal
  if (req.user.role === 'agent' && conv.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Sin acceso a esta conversacion' })
  }

  res.json({ ...conv, is_group: !!conv.is_group })
}

export async function assign(req, res) {
  const { agent_id } = req.body
  if (!agent_id) return res.status(400).json({ error: 'agent_id requerido' })

  await db('conversations').where('id', req.params.id).update({
    assigned_agent_id: agent_id,
    status: 'open',
    updated_at: new Date(),
  })

  const conv = await db('conversations as c')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .leftJoin('users as ag', 'c.assigned_agent_id', 'ag.id')
    .select('c.*', 'ch.type as channel_type', 'ch.name as channel_name', 'ch.branch_id',
            'ct.name as contact_name', 'ct.phone', 'ct.email as contact_email',
            'ag.name as agent_name')
    .where('c.id', req.params.id)
    .first()

  // Emitir por Socket.io al room de la sucursal correcta y a all_branches
  const assignRooms = conv.branch_id ? [`branch_${conv.branch_id}`, 'all_branches'] : ['all_branches']
  req.io.to(assignRooms).emit('conversation:updated', conv)

  res.json(conv)
}

export async function updateStatus(req, res) {
  const { status } = req.body
  const allowed = ['open', 'pending', 'resolved', 'snoozed']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado invalido' })

  const update = { status, updated_at: new Date() }
  if (status === 'resolved') update.resolved_at = new Date()

  await db('conversations').where('id', req.params.id).update(update)
  const conv = await db('conversations as c')
    .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    .select('c.*', 'ch.branch_id')
    .where('c.id', req.params.id)
    .first()

  const statusRooms = conv?.branch_id ? [`conv_${req.params.id}`, `branch_${conv.branch_id}`, 'all_branches'] : [`conv_${req.params.id}`, 'all_branches']
  req.io.to(statusRooms).emit('conversation:updated', conv)

  res.json(conv)
}

export async function markRead(req, res) {
  const convId = req.params.id

  // Datos de conversación + canal + contacto antes de marcar leído
  const convFull = await db('conversations as c')
    .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .select(
      'c.id', 'c.unread_count', 'c.status', 'c.last_message_at', 'c.channel_id',
      'ch.branch_id', 'ch.session_id', 'ch.type as channel_type', 'ch.status as channel_status',
      'ct.phone', 'ct.meta as contact_meta', 'ct.is_group',
    )
    .where('c.id', convId)
    .first()

  if (!convFull) return res.status(404).json({ error: 'Conversacion no encontrada' })

  // Mensajes inbound aún sin read_at (con external_id de WhatsApp)
  const unreadMsgs = await db('messages')
    .where('conversation_id', convId)
    .where('direction', 'inbound')
    .whereNull('read_at')
    .whereNotNull('external_id')
    .select('id', 'external_id', 'meta')

  await db('conversations').where('id', convId).update({ unread_count: 0, updated_at: new Date() })
  await db('messages').where('conversation_id', convId).whereNull('read_at').update({ read_at: new Date() })

  // Notificar al listado para quitar el badge de no leídos
  const rooms = convFull.branch_id
    ? [`conv_${convId}`, `branch_${convFull.branch_id}`, 'all_branches']
    : [`conv_${convId}`, 'all_branches']
  req.io.to(rooms).emit('conversation:updated', {
    id: Number(convFull.id),
    unread_count: 0,
    status: convFull.status,
    last_message_at: convFull.last_message_at,
    channel: convFull.channel_id ? { id: convFull.channel_id } : undefined,
  })

  res.json({ ok: true, unread_count: 0 })

  // ── Enviar "visto" azul a WhatsApp en background ──
  if (
    convFull.channel_type === 'whatsapp'
    && convFull.session_id
    && convFull.channel_status === 'active'
    && unreadMsgs.length
  ) {
    try {
      const remoteJid = resolveRemoteJidForRead(convFull)
      if (!remoteJid) {
        console.warn(`[markRead] No se pudo resolver JID para conv ${convId}`)
        return
      }

      const keys = unreadMsgs.map(m => {
        let participant = null
        if (m.meta) {
          try {
            const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta
            participant = meta?.participant_jid || null
          } catch {}
        }
        return {
          remoteJid,
          id: m.external_id,
          fromMe: false,
          ...(participant ? { participant } : {}),
        }
      })

      await markWhatsAppRead(convFull.session_id, keys)
    } catch (err) {
      console.error(`[markRead] Error enviando visto WhatsApp conv ${convId}:`, err.message)
    }
  }
}

/** Resuelve el remoteJid del contacto para readMessages de Baileys. */
function resolveRemoteJidForRead(conv) {
  const meta = parseContactMeta(conv.contact_meta)

  // Grupo: el phone guarda el jid del grupo (@g.us)
  if (conv.is_group && conv.phone && String(conv.phone).includes('@g.us')) {
    return conv.phone
  }

  // Preferir jid guardado en meta (incluye @lid o @s.whatsapp.net)
  if (meta.whatsapp_jid) {
    try {
      return jidNormalizedUser(meta.whatsapp_jid)
    } catch {
      return meta.whatsapp_jid
    }
  }

  const resolved = resolveOutboundTarget(conv.phone, conv.contact_meta)
  if (!resolved) return null

  if (resolved.kind === 'jid') {
    try {
      return jidNormalizedUser(resolved.target)
    } catch {
      return resolved.target
    }
  }

  // phone: construir jid PN
  const digits = String(resolved.target).replace(/\D/g, '')
  if (!digits) return null
  return `${digits}@s.whatsapp.net`
}

export async function remove(req, res) {
  // Solo admin puede eliminar conversaciones
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden eliminar conversaciones' })
  }

  const conv = await db('conversations').where('id', req.params.id).first()
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' })

  // Eliminar mensajes de la conversación
  await db('messages').where('conversation_id', req.params.id).del()

  // Eliminar la conversación
  await db('conversations').where('id', req.params.id).del()

  res.json({ deleted: true })
}
