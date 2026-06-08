import db from '../db/knex.js'
import { startSession, stopSession } from '../services/whatsapp.service.js'

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

  // ✅ BORRAR sesión vieja para forzar nuevo QR
  if (channel.session_id) {
    try {
      rmSync(join('./sessions', channel.session_id), { recursive: true, force: true })
    } catch (_) {}
  }

  await db('channels').where('id', channel.id).update({ status: 'connecting', updated_at: new Date() })
  startSession(channel, req.io)

  res.json({ message: 'Reconexion iniciada' })
}

export async function getQr(req, res) {
  const channel = await db('channels').where('id', req.params.id).first()
  if (!channel) return res.status(404).json({ error: 'Canal no encontrado' })

  const meta = channel.meta ? JSON.parse(channel.meta) : {}
  res.json({ status: channel.status, qr: meta.qr || null })
}
