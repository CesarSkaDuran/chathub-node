import db from '../db/knex.js'
import { getSessionHealthStatus, startSession, stopSession } from '../services/whatsapp.service.js'
import { rmSync } from 'fs'
import { join } from 'path'

function clearSessionFolder(session_id) {
  if (!session_id) return
  try {
    rmSync(join('./sessions', session_id), { recursive: true, force: true })
  } catch (_) {}
}

export async function list(req, res) {
  const { branch_id } = req.query
  let q = db('channels as ch').join('branches as b', 'ch.branch_id', 'b.id')
    .select('ch.*', 'b.name as branch_name')

  if (req.user.role === 'agent') {
    q = q.where('ch.branch_id', req.user.branch_id)
  } else if (branch_id) {
    q = q.where('ch.branch_id', branch_id)
  }

  res.json(await q.orderBy('ch.created_at', 'desc'))
}

export async function create(req, res) {
  const { branch_id, type, name, identifier } = req.body
  if (!branch_id || !type || !name || !identifier) {
    return res.status(400).json({ error: 'branch_id, type, name e identifier son requeridos' })
  }

  const session_id = type === 'whatsapp' ? `session_${identifier}` : null

  const [id] = await db('channels').insert({
    branch_id, type, name, identifier, session_id,
    status: 'inactive', created_at: new Date(), updated_at: new Date(),
  })

  const channel = await db('channels').where('id', id).first()

  if (type === 'whatsapp') {
    startSession(channel, req.io)
  }

  res.status(201).json(channel)
}

export async function update(req, res) {
  const { branch_id, type, name, identifier } = req.body
  const channel = await db('channels').where('id', req.params.id).first()
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })

  const data = { updated_at: new Date() }
  if (branch_id !== undefined) data.branch_id = branch_id
  if (type !== undefined) data.type = type
  if (name !== undefined) data.name = name
  if (identifier !== undefined) {
    data.identifier = identifier
    data.session_id = data.type === 'whatsapp' || channel.type === 'whatsapp'
      ? `session_${identifier}`
      : null
  }

  await db('channels').where('id', req.params.id).update(data)
  const updated = await db('channels as ch')
    .join('branches as b', 'ch.branch_id', 'b.id')
    .select('ch.*', 'b.name as branch_name')
    .where('ch.id', req.params.id)
    .first()

  res.json(updated)
}

export async function remove(req, res) {
  const channel = await db('channels').where('id', req.params.id).first()
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })

  if (channel.type === 'whatsapp' && channel.session_id) {
    await stopSession(channel.session_id)
  }

  await db('channels').where('id', req.params.id).del()
  res.json({ deleted: true })
}


export async function reconnect(req, res) {
  const channel = await db('channels').where('id', req.params.id).first()
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })
  if (channel.type !== 'whatsapp') return res.status(400).json({ error: 'Solo para canales WhatsApp' })

  // Detener sesión activa si existe y limpiar credenciales viejas
  if (channel.session_id) {
    await stopSession(channel.session_id)
    clearSessionFolder(channel.session_id)
  }

  await db('channels').where('id', channel.id).update({
    status: 'connecting',
    meta: JSON.stringify({}),
    updated_at: new Date(),
  })
  startSession(channel, req.io)

  res.json({ message: 'Reconexion iniciada' })
}

export async function getQr(req, res) {
  const channel = await db('channels').where('id', req.params.id).first()
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })

  const meta = channel.meta ? (typeof channel.meta === 'string' ? JSON.parse(channel.meta) : channel.meta) : {}
  res.json({ status: channel.status, qr: meta.qr || null })
}

export async function health(req, res) {
  const channel = await db('channels').where('id', req.params.id).first()
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })
  if (channel.type !== 'whatsapp') return res.status(400).json({ error: 'Solo para canales WhatsApp' })

  const pendingSince = new Date(Date.now() - 60_000)
  const sentSince = new Date(Date.now() - 5 * 60_000)
  const lastDay = new Date(Date.now() - 24 * 60 * 60_000)
  const conversations = db('conversations').select('id').where('channel_id', channel.id)

  const [stuckPending, undelivered, latestInbound] = await Promise.all([
    db('messages').whereIn('conversation_id', conversations.clone())
      .where({ direction: 'outbound', status: 'pending' })
      .where('created_at', '<', pendingSince).count('id as total').first(),
    db('messages').whereIn('conversation_id', conversations.clone())
      .where({ direction: 'outbound', status: 'sent' })
      .where('created_at', '>=', lastDay).where('created_at', '<', sentSince)
      .count('id as total').first(),
    db('messages').whereIn('conversation_id', conversations.clone())
      .where('direction', 'inbound').max('created_at as created_at').first(),
  ])

  const runtime = getSessionHealthStatus(channel.session_id)
  const pendingCount = Number(stuckPending?.total || 0)
  const undeliveredCount = Number(undelivered?.total || 0)
  const issues = []
  if (channel.status !== 'active') issues.push('El canal no figura activo')
  if (!runtime.loaded || runtime.runtime_status !== 'active') issues.push('La sesion no esta activa en el proceso')
  if (runtime.flap_count > 0) issues.push('La conexion ha presentado reinicios recientes')
  if (pendingCount > 0) issues.push(`${pendingCount} mensaje(s) llevan mas de un minuto pendientes`)
  if (undeliveredCount > 0) issues.push(`${undeliveredCount} mensaje(s) recientes no tienen confirmacion de entrega`)

  res.json({
    healthy: issues.length === 0,
    needs_repair: issues.length > 0,
    issues,
    database_status: channel.status,
    stuck_pending: pendingCount,
    undelivered: undeliveredCount,
    latest_inbound_at: latestInbound?.created_at || null,
    ...runtime,
  })
}

export async function repair(req, res) {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Debes confirmar la reparacion del canal' })
  }

  const channel = await db('channels').where('id', req.params.id).first()
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })
  if (channel.type !== 'whatsapp') return res.status(400).json({ error: 'Solo para canales WhatsApp' })

  if (channel.session_id) {
    await stopSession(channel.session_id)
    clearSessionFolder(channel.session_id)
  }

  await db('channels').where('id', channel.id).update({
    status: 'connecting',
    meta: JSON.stringify({}),
    updated_at: new Date(),
  })
  startSession(channel, req.io)

  res.json({ message: 'Reparacion iniciada; escanea el nuevo codigo QR' })
}
