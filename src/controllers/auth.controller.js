import bcrypt from 'bcryptjs'
import db from '../db/knex.js'
import { validateRequired } from '../utils/http.js'
import { userWithBranch, signToken } from '../utils/auth.js'

export async function login(req, res) {
  const { email, password } = req.body

  if (!validateRequired(res, req.body, ['email', 'password'], 'Email y password requeridos')) return

  const user = await userWithBranch({ withPassword: true })
    .where('users.email', email)
    .first()

  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' })
  if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' })

  await db('users').where('id', user.id).update({ last_seen_at: new Date() })

  const token = signToken(user)

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
