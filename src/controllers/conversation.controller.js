import db from '../db/knex.js'
import { loadAccessibleConversation } from '../utils/access.js'

// Query base con joins
function convQuery(user) {
  let q = db('conversations as c')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .leftJoin('users as ag', 'c.assigned_agent_id', 'ag.id')
    .select(
      'c.id', 'c.status', 'c.unread_count', 'c.last_message_at', 'c.assigned_agent_id',
      'ch.id as channel_id', 'ch.type as channel_type', 'ch.name as channel_name',
      'ct.id as contact_id', 'ct.name as contact_name', 'ct.phone', 'ct.email as contact_email',
      'ag.id as agent_id', 'ag.name as agent_name'
    )

  // Agente: solo su sucursal
  if (user.role === 'agent') {
    q = q.where('ch.branch_id', user.branch_id)
  }

  return q
}

export async function list(req, res) {
  const { status, channel_id, branch_id, search, page = 1, limit = 25 } = req.query
  const offset = (Number(page) - 1) * Number(limit)

  let q = convQuery(req.user)

  if (status)     q = q.where('c.status', status)
  if (channel_id) q = q.where('c.channel_id', channel_id)
  if (branch_id && req.user.role !== 'agent') q = q.where('ch.branch_id', branch_id)
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
    contact:      { id: r.contact_id, name: r.contact_name, phone: r.phone, email: r.contact_email },
    assigned_agent: r.agent_id ? { id: r.agent_id, name: r.agent_name } : null,
    last_message: msgMap[r.id] || null,
  }))

  res.json({ data, total: Number(countRow.total), page: Number(page), limit: Number(limit) })
}

export async function show(req, res) {
  const conv = await db('conversations as c')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .leftJoin('users as ag', 'c.assigned_agent_id', 'ag.id')
    .select('c.*', 'ch.type as channel_type', 'ch.name as channel_name', 'ch.branch_id',
            'ct.name as contact_name', 'ct.phone', 'ct.email as contact_email',
            'ag.name as agent_name')
    .where('c.id', req.params.id)
    .first()

  if (!conv) return res.status(404).json({ error: 'Conversacion no encontrada' })

  // Agente: validar su sucursal
  if (req.user.role === 'agent' && conv.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Sin acceso a esta conversacion' })
  }

  res.json(conv)
}

export async function assign(req, res) {
  const { agent_id } = req.body
  if (!agent_id) return res.status(400).json({ error: 'agent_id requerido' })

  const { error } = await loadAccessibleConversation(req.user, req.params.id)
  if (error) return res.status(error.status).json({ error: error.message })

  await db('conversations').where('id', req.params.id).update({
    assigned_agent_id: agent_id,
    status: 'open',
    updated_at: new Date(),
  })

  const conv = await db('conversations').where('id', req.params.id).first()

  // Emitir por Socket.io
  req.io.to(`branch_${conv.channel_id}`).emit('conversation:updated', conv)

  res.json(conv)
}

export async function updateStatus(req, res) {
  const { status } = req.body
  const allowed = ['open', 'pending', 'resolved', 'snoozed']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado invalido' })

  const { error } = await loadAccessibleConversation(req.user, req.params.id)
  if (error) return res.status(error.status).json({ error: error.message })

  const update = { status, updated_at: new Date() }
  if (status === 'resolved') update.resolved_at = new Date()

  await db('conversations').where('id', req.params.id).update(update)
  const conv = await db('conversations').where('id', req.params.id).first()

  req.io.to(`conv_${req.params.id}`).emit('conversation:updated', conv)

  res.json(conv)
}

export async function markRead(req, res) {
  const { error } = await loadAccessibleConversation(req.user, req.params.id)
  if (error) return res.status(error.status).json({ error: error.message })

  await db('conversations').where('id', req.params.id).update({ unread_count: 0, updated_at: new Date() })
  await db('messages').where('conversation_id', req.params.id).whereNull('read_at').update({ read_at: new Date() })
  res.json({ ok: true })
}
