import { userWithBranch, verifyToken } from '../utils/auth.js'

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  const token = header.slice(7)

  try {
    const payload = verifyToken(token)
    const user = await userWithBranch()
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
