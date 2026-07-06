import jwt from 'jsonwebtoken'
import db from '../db/knex.js'

const USER_COLUMNS = [
  'users.id', 'users.name', 'users.email',
  'users.role', 'users.branch_id', 'users.is_active',
  'branches.name as branch_name', 'branches.slug as branch_slug',
]

const USER_COLUMNS_WITH_PASSWORD = [
  'users.id', 'users.name', 'users.email', 'users.password',
  'users.role', 'users.branch_id', 'users.is_active',
  'branches.name as branch_name', 'branches.slug as branch_slug',
]

/**
 * Query base de usuarios con su sucursal (join a branches).
 * withPassword=true incluye la columna password (solo para login).
 */
export function userWithBranch({ withPassword = false } = {}) {
  return db('users')
    .leftJoin('branches', 'users.branch_id', 'branches.id')
    .select(withPassword ? USER_COLUMNS_WITH_PASSWORD : USER_COLUMNS)
}

/**
 * Firma un JWT con el payload estandar del usuario.
 */
export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, branch_id: user.branch_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )
}

/**
 * Verifica y decodifica un JWT. Lanza si es invalido o expiro.
 */
export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}
