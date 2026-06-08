import bcrypt from 'bcryptjs'
import db from '../db/knex.js'

export async function list(req, res) {
  const { branch_id } = req.query
  let q = db('users as u')
    .leftJoin('branches as b', 'u.branch_id', 'b.id')
    .select('u.id', 'u.name', 'u.email', 'u.role', 'u.is_active', 'u.last_seen_at',
            'u.branch_id', 'b.name as branch_name')

  if (req.user.role === 'agent') {
    q = q.where('u.branch_id', req.user.branch_id)
  } else if (branch_id) {
    q = q.where('u.branch_id', branch_id)
  }

  res.json(await q.where('u.is_active', true).orderBy('u.name'))
}

export async function create(req, res) {
  const { name, email, password, role, branch_id } = req.body
  if (!name || !email || !password || !role || !branch_id) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' })
  }

  const exists = await db('users').where('email', email).first()
  if (exists) return res.status(409).json({ error: 'El email ya esta registrado' })

  const hashed = await bcrypt.hash(password, 10)
  const [id] = await db('users').insert({
    name, email, password: hashed, role, branch_id,
    is_active: true, created_at: new Date(), updated_at: new Date(),
  })

  const user = await db('users').where('id', id).select('id', 'name', 'email', 'role', 'branch_id').first()
  res.status(201).json(user)
}

export async function update(req, res) {
  const { name, branch_id, role, is_active, password } = req.body
  const data = { updated_at: new Date() }

  if (name)      data.name      = name
  if (branch_id) data.branch_id = branch_id
  if (role)      data.role      = role
  if (is_active !== undefined) data.is_active = is_active
  if (password)  data.password  = await bcrypt.hash(password, 10)

  await db('users').where('id', req.params.id).update(data)
  const user = await db('users').where('id', req.params.id)
    .select('id', 'name', 'email', 'role', 'branch_id', 'is_active').first()

  res.json(user)
}
