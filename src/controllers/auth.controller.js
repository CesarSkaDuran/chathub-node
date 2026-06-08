import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db/knex.js'

export async function login(req, res) {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y password requeridos' })
  }

  const user = await db('users')
    .leftJoin('branches', 'users.branch_id', 'branches.id')
    .select(
      'users.id', 'users.name', 'users.email', 'users.password',
      'users.role', 'users.branch_id', 'users.is_active',
      'branches.name as branch_name', 'branches.slug as branch_slug'
    )
    .where('users.email', email)
    .first()

  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' })
  if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' })

  await db('users').where('id', user.id).update({ last_seen_at: new Date() })

  const token = jwt.sign(
    { id: user.id, role: user.role, branch_id: user.branch_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )

  const { password: _, ...userSafe } = user

  res.json({ token, user: userSafe })
}

export async function me(req, res) {
  res.json({ user: req.user })
}

export async function logout(req, res) {
  // Con JWT stateless el logout es del lado del cliente.
  // Para logout real implementar blacklist en Redis.
  res.json({ message: 'Sesion cerrada' })
}
