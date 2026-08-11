import db from '../db/knex.js'

export async function list(req, res) {
  const { branch_id } = req.query
  let q = db('quick_replies').orderBy('shortcut', 'asc')

  if (branch_id) {
    q = q.where(function () {
      this.where('branch_id', branch_id).orWhereNull('branch_id')
    })
  }

  res.json(await q)
}

export async function create(req, res) {
  const { shortcut, content, branch_id } = req.body
  if (!shortcut || !content) {
    return res.status(400).json({ error: 'shortcut y content son requeridos' })
  }

  const cleanShortcut = shortcut.startsWith('/') ? shortcut : `/${shortcut}`

  try {
    const [id] = await db('quick_replies').insert({
      shortcut: cleanShortcut,
      content,
      branch_id: branch_id || null,
      created_at: new Date(),
      updated_at: new Date(),
    })
    const reply = await db('quick_replies').where('id', id).first()
    res.status(201).json(reply)
  } catch (err) {
    if (err.message?.includes('Duplicate')) {
      return res.status(409).json({ error: 'Ese atajo ya existe' })
    }
    throw err
  }
}

export async function update(req, res) {
  const { shortcut, content, branch_id } = req.body
  if (!shortcut || !content) {
    return res.status(400).json({ error: 'shortcut y content son requeridos' })
  }

  const cleanShortcut = shortcut.startsWith('/') ? shortcut : `/${shortcut}`

  const existing = await db('quick_replies').where('id', req.params.id).first()
  if (!existing) return res.status(404).json({ error: 'Respuesta rápida no encontrada' })

  await db('quick_replies').where('id', req.params.id).update({
    shortcut: cleanShortcut,
    content,
    branch_id: branch_id || null,
    updated_at: new Date(),
  })

  const reply = await db('quick_replies').where('id', req.params.id).first()
  res.json(reply)
}

export async function remove(req, res) {
  const existing = await db('quick_replies').where('id', req.params.id).first()
  if (!existing) return res.status(404).json({ error: 'Respuesta rápida no encontrada' })

  await db('quick_replies').where('id', req.params.id).del()
  res.json({ deleted: true })
}
