import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})
vi.mock('jsonwebtoken', () => ({
  default: { verify: vi.fn(), sign: vi.fn() },
}))

import jwt from 'jsonwebtoken'
import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeRes } from '../helpers/dbMock.js'
import { authMiddleware, requireRole, canAccessBranch } from '../../src/middlewares/auth.js'

beforeEach(() => {
  resetDbMock(db)
  jwt.verify.mockReset()
})

describe('authMiddleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = { headers: {} }
    const res = makeRes()
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toEqual({ error: 'Token requerido' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when header does not start with "Bearer "', async () => {
    const req = { headers: { authorization: 'Token abc' } }
    const res = makeRes()
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toEqual({ error: 'Token requerido' })
  })

  it('attaches the user and calls next for a valid token', async () => {
    const user = { id: 7, name: 'Ana', role: 'agent', branch_id: 2, is_active: 1 }
    jwt.verify.mockReturnValue({ id: 7 })
    db.__first.mockResolvedValueOnce(user)

    const req = { headers: { authorization: 'Bearer good.token' } }
    const res = makeRes()
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(jwt.verify).toHaveBeenCalledWith('good.token', process.env.JWT_SECRET)
    expect(req.user).toEqual(user)
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 401 when the user is not found', async () => {
    jwt.verify.mockReturnValue({ id: 99 })
    db.__first.mockResolvedValueOnce(undefined)

    const req = { headers: { authorization: 'Bearer good.token' } }
    const res = makeRes()
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toEqual({ error: 'Usuario no encontrado' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is inactive', async () => {
    jwt.verify.mockReturnValue({ id: 7 })
    db.__first.mockResolvedValueOnce({ id: 7, is_active: 0 })

    const req = { headers: { authorization: 'Bearer good.token' } }
    const res = makeRes()
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body).toEqual({ error: 'Usuario inactivo' })
  })

  it('returns 401 when jwt verification throws', async () => {
    jwt.verify.mockImplementation(() => { throw new Error('bad token') })

    const req = { headers: { authorization: 'Bearer bad.token' } }
    const res = makeRes()
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toEqual({ error: 'Token invalido o expirado' })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('requireRole', () => {
  it('calls next when the user has an allowed role', () => {
    const middleware = requireRole('admin', 'supervisor')
    const req = { user: { role: 'supervisor' } }
    const res = makeRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 403 when the user role is not allowed', () => {
    const middleware = requireRole('admin')
    const req = { user: { role: 'agent' } }
    const res = makeRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body).toEqual({ error: 'Sin permiso para esta accion' })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('canAccessBranch', () => {
  it('always allows admins and supervisors', () => {
    expect(canAccessBranch({ role: 'admin', branch_id: 1 }, 999)).toBe(true)
    expect(canAccessBranch({ role: 'supervisor', branch_id: 1 }, 999)).toBe(true)
  })

  it('allows an agent only for their own branch', () => {
    expect(canAccessBranch({ role: 'agent', branch_id: 5 }, 5)).toBe(true)
    expect(canAccessBranch({ role: 'agent', branch_id: 5 }, '5')).toBe(true)
    expect(canAccessBranch({ role: 'agent', branch_id: 5 }, 6)).toBe(false)
  })
})
