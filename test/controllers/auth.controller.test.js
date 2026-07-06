import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }))
vi.mock('jsonwebtoken', () => ({ default: { sign: vi.fn(), verify: vi.fn() } }))

import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeRes } from '../helpers/dbMock.js'
import { login, me, logout } from '../../src/controllers/auth.controller.js'

beforeEach(() => {
  resetDbMock(db)
  bcrypt.compare.mockReset()
  jwt.sign.mockReset()
})

describe('login', () => {
  it('returns 400 when email or password is missing', async () => {
    const res = makeRes()
    await login({ body: { email: 'a@b.com' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.body).toEqual({ error: 'Email y password requeridos' })
  })

  it('returns 401 when the user does not exist', async () => {
    db.__first.mockResolvedValueOnce(undefined)
    const res = makeRes()
    await login({ body: { email: 'x@y.com', password: 'p' } }, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toEqual({ error: 'Credenciales incorrectas' })
  })

  it('returns 403 when the user is inactive', async () => {
    db.__first.mockResolvedValueOnce({ id: 1, password: 'h', is_active: 0 })
    const res = makeRes()
    await login({ body: { email: 'x@y.com', password: 'p' } }, res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body).toEqual({ error: 'Usuario inactivo' })
  })

  it('returns 401 when the password does not match', async () => {
    db.__first.mockResolvedValueOnce({ id: 1, password: 'hash', is_active: 1 })
    bcrypt.compare.mockResolvedValueOnce(false)
    const res = makeRes()
    await login({ body: { email: 'x@y.com', password: 'wrong' } }, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toEqual({ error: 'Credenciales incorrectas' })
  })

  it('returns a token and the user without the password on success', async () => {
    const user = {
      id: 3, name: 'Admin', email: 'admin@chathub.com', password: 'hash',
      role: 'admin', branch_id: null, is_active: 1,
    }
    db.__first.mockResolvedValueOnce(user)
    bcrypt.compare.mockResolvedValueOnce(true)
    jwt.sign.mockReturnValue('signed.jwt')

    const res = makeRes()
    await login({ body: { email: 'admin@chathub.com', password: 'password' } }, res)

    expect(bcrypt.compare).toHaveBeenCalledWith('password', 'hash')
    expect(jwt.sign).toHaveBeenCalledWith(
      { id: 3, role: 'admin', branch_id: null },
      process.env.JWT_SECRET,
      expect.objectContaining({ expiresIn: expect.anything() }),
    )
    // last_seen_at update issued
    expect(db.__update).toHaveBeenCalledOnce()
    expect(res.body.token).toBe('signed.jwt')
    expect(res.body.user).not.toHaveProperty('password')
    expect(res.body.user.email).toBe('admin@chathub.com')
  })
})

describe('me', () => {
  it('returns the authenticated user from req.user', async () => {
    const res = makeRes()
    const user = { id: 1, role: 'admin' }
    await me({ user }, res)
    expect(res.body).toEqual({ user })
  })
})

describe('logout', () => {
  it('responds with a confirmation message', async () => {
    const res = makeRes()
    await logout({}, res)
    expect(res.body).toEqual({ message: 'Sesion cerrada' })
  })
})
