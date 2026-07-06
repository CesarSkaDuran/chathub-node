import { rmSync } from 'fs'
import db from '../db/knex.js'
import { startSession, stopSession } from '../services/whatsapp.service.js'
import { timestamps, touch, scopeByBranch, findById } from '../utils/db.js'
import { validateRequired } from '../utils/http.js'
import { sessionDir } from '../utils/session-path.js'

export async function list(req, res) {
  const { branch_id } = req.query
  let q = db('channels as ch').join('branches as b', 'ch.branch_id', 'b.id')
    .select('ch.*', 'b.name as branch_name')

  if (req.user.role === 'agent') {
    q = scopeByBranch(q, req.user, 'ch.branch_id')
  } else if (branch_id) {
    q = q.where('ch.branch_id', branch_id)
  }

  res.json(await q.orderBy('ch.created_at', 'desc'))
}

export async function create(req, res) {
  const { branch_id, type, name, identifier } = req.body
  if (!validateRequired(res, req.body, ['branch_id', 'type', 'name', 'identifier'],
    'branch_id, type, name e identifier son requeridos')) return

  // identifier se usa para construir la ruta de la sesion: solo caracteres seguros
  if (type === 'whatsapp' && !/^[A-Za-z0-9._-]+$/.test(String(identifier))) {
    return res.status(400).json({ error: 'identifier invalido' })
  }

  const session_id = type === 'whatsapp' ? `session_${identifier}` : null

  const [id] = await db('channels').insert({
    branch_id, type, name, identifier, session_id,
    status: 'inactive', ...timestamps(),
  })

  const channel = await findById('channels', id)

  if (type === 'whatsapp') {
    startSession(channel, req.io)
  }

  res.status(201).json(channel)
}

export async function remove(req, res) {
  const channel = await findById('channels', req.params.id)
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })

  if (channel.type === 'whatsapp' && channel.session_id) {
    await stopSession(channel.session_id)
  }

  await db('channels').where('id', req.params.id).del()
  res.json({ deleted: true })
}


export async function reconnect(req, res) {
  const channel = await findById('channels', req.params.id)
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })
  if (channel.type !== 'whatsapp') return res.status(400).json({ error: 'Solo para canales WhatsApp' })

  // Borrar sesión vieja para forzar nuevo QR
  if (channel.session_id) {
    try {
      rmSync(sessionDir(channel.session_id), { recursive: true, force: true })
    } catch (_) {}
  }

  await db('channels').where('id', channel.id).update(touch({ status: 'connecting' }))
  startSession(channel, req.io)

  res.json({ message: 'Reconexion iniciada' })
}

export async function getQr(req, res) {
  const channel = await findById('channels', req.params.id)
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })

  const meta = channel.meta ? JSON.parse(channel.meta) : {}
  res.json({ status: channel.status, qr: meta.qr || null })
}
