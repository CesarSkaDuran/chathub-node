import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/knex.js', async () => {
  const { db } = await import('../helpers/dbSingleton.js')
  return { default: db }
})
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(), compare: vi.fn() } }))

import bcrypt from 'bcryptjs'
import { db } from '../helpers/dbSingleton.js'
import { resetDbMock, makeRes } from '../helpers/dbMock.js'
import { list, create, update } from '../../src/controllers/agent.controller.js'

beforeEach(() => {
  resetDbMock(db)
  bcrypt.hash.mockReset()
})

describe('list', () => {
  it('returns the active users for the query', async () => {
    const rows = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Beto' }]
    db.__rows.mockReturnValue(rows)
    const res = makeRes()

    await list({ user: { role: 'admin' }, query: {} }, res)

    expect(db).toHaveBeenCalledWith('users as u')
    expect(res.body).toEqual(rows)
  })

  it('runs for an agent scoped to their branch', async () => {
    db.__rows.mockReturnValue([])
    const res = makeRes()
    await list({ user: { role: 'agent', branch_id: 4 }, query: {} }, res)
    expect(res.body).toEqual([])
  })
})

describe('create', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = makeRes()
    await create({ body: { name: 'Ana' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.body).toEqual({ error: 'Todos los campos son requeridos' })
  })

  it('returns 409 when the email is already registered', async () => {
    db.__first.mockResolvedValueOnce({ id: 1 })
    const res = makeRes()
    await create({
      body: { name: 'Ana', email: 'a@b.com', password: 'p', role: 'agent', branch_id: 1 },
    }, res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.body).toEqual({ error: 'El email ya esta registrado' })
  })

  it('hashes the password, inserts, and returns the created user', async () => {
    db.__first
      .mockResolvedValueOnce(undefined) // email uniqueness check
      .mockResolvedValueOnce({ id: 10, name: 'Ana', email: 'a@b.com', role: 'agent', branch_id: 1 })
    db.__insert.mockResolvedValueOnce([10])
    bcrypt.hash.mockResolvedValueOnce('hashed-pw')

    const res = makeRes()
    await create({
      body: { name: 'Ana', email: 'a@b.com', password: 'secret', role: 'agent', branch_id: 1 },
    }, res)

    expect(bcrypt.hash).toHaveBeenCalledWith('secret', 10)
    expect(db.__insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ana', email: 'a@b.com', password: 'hashed-pw', role: 'agent', branch_id: 1, is_active: true,
    }))
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.body).toEqual({ id: 10, name: 'Ana', email: 'a@b.com', role: 'agent', branch_id: 1 })
  })
})

describe('update', () => {
  it('updates only provided fields and hashes a new password', async () => {
    const updated = { id: 5, name: 'Nuevo', email: 'a@b.com', role: 'agent', branch_id: 2, is_active: true }
    db.__first.mockResolvedValueOnce(updated)
    bcrypt.hash.mockResolvedValueOnce('new-hash')

    const res = makeRes()
    await update({ params: { id: 5 }, body: { name: 'Nuevo', password: 'np', is_active: false } }, res)

    expect(bcrypt.hash).toHaveBeenCalledWith('np', 10)
    const data = db.__update.mock.calls[0][0]
    expect(data).toMatchObject({ name: 'Nuevo', password: 'new-hash', is_active: false })
    expect(data).not.toHaveProperty('role')
    expect(res.body).toEqual(updated)
  })

  it('does not hash when no password is provided', async () => {
    db.__first.mockResolvedValueOnce({ id: 5 })
    const res = makeRes()
    await update({ params: { id: 5 }, body: { role: 'supervisor' } }, res)
    expect(bcrypt.hash).not.toHaveBeenCalled()
    expect(db.__update.mock.calls[0][0]).toMatchObject({ role: 'supervisor' })
  })
})
