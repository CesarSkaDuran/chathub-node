import jwt from 'jsonwebtoken'
import db from '../db/knex.js'

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  const token = header.slice(7)

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const user = await db('users')
      .leftJoin('branches', 'users.branch_id', 'branches.id')
      .select(
        'users.id', 'users.name', 'users.email',
        'users.role', 'users.branch_id', 'users.is_active',
        'branches.name as branch_name', 'branches.slug as branch_slug'
      )
      .where('users.id', payload.id)
      .first()

    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' })
    if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' })

    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado' })
  }
}

// Middleware de roles: requireRole('admin', 'supervisor')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sin permiso para esta accion' })
    }
    next()
  }
}

// Helper: el agente solo accede a su sucursal
export function canAccessBranch(user, branchId) {
  if (user.role === 'admin' || user.role === 'supervisor') return true
  return user.branch_id === Number(branchId)
}
