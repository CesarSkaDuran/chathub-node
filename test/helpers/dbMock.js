import { vi } from 'vitest'

/**
 * Mock of the Knex `db` default export used across the app.
 *
 * Knex's query builder is both chainable (`.where().join().orderBy()`) and
 * awaitable (`await db('t').where(...)` resolves to rows). This mock reproduces
 * that shape:
 *   - Chain methods (`where`, `join`, `select`, `orderBy`, `modify`, ...) return
 *     the same builder so calls can be chained.
 *   - Terminal behaviours are exposed as `vi.fn`s on the `db` object itself
 *     (`db.__rows`, `db.__first`, `db.__count`, `db.__insert`, `db.__update`,
 *     `db.__del`) so a test can drive them with `mockResolvedValueOnce(...)`.
 *   - Awaiting a builder resolves to `db.__rows()`.
 *
 * `db.raw(...)` is a no-op marker and callbacks passed to `where(fn)` / `modify(fn)`
 * are invoked with the builder so the code under test executes fully.
 */
export function createDbMock() {
  const db = vi.fn((table) => makeBuilder(db, table))

  db.__rows = vi.fn(() => [])
  db.__first = vi.fn(() => undefined)
  db.__count = vi.fn(() => [{ total: 0, n: 0 }])
  db.__insert = vi.fn(() => [1])
  db.__update = vi.fn(() => 1)
  db.__del = vi.fn(() => 1)

  db.raw = vi.fn((...args) => ({ __raw: args }))

  return db
}

const CHAIN_METHODS = [
  'select', 'column', 'columns', 'distinct',
  'where', 'andWhere', 'orWhere', 'whereNot', 'whereRaw',
  'whereIn', 'whereNotIn', 'whereNull', 'whereNotNull', 'whereExists',
  'join', 'leftJoin', 'rightJoin', 'innerJoin', 'crossJoin',
  'on', 'onIn', 'andOn', 'orOn',
  'groupBy', 'groupByRaw', 'having', 'havingRaw',
  'orderBy', 'orderByRaw', 'limit', 'offset',
  'returning', 'as',
]

function makeBuilder(db, table) {
  const builder = { __table: table }

  for (const name of CHAIN_METHODS) {
    builder[name] = vi.fn((arg) => {
      // Knex supports callback grouping: `.where(function () { this.where(...) })`
      if (typeof arg === 'function') {
        try { arg.call(builder, builder) } catch { /* ignore */ }
      }
      return builder
    })
  }

  builder.modify = vi.fn((cb) => {
    if (typeof cb === 'function') {
      try { cb(builder) } catch { /* ignore */ }
    }
    return builder
  })

  // clone() yields an independent builder so aggregate calls on a clone (e.g.
  // `q.clone().count(...)`) don't change how the original builder resolves.
  builder.clone = vi.fn(() => makeBuilder(db, table))

  // Terminal-only helpers: always awaited immediately in the codebase.
  builder.first = vi.fn((...a) => Promise.resolve(db.__first(...a)))
  builder.insert = vi.fn((...a) => Promise.resolve(db.__insert(...a)))
  builder.update = vi.fn((...a) => Promise.resolve(db.__update(...a)))
  builder.del = vi.fn((...a) => Promise.resolve(db.__del(...a)))
  builder.delete = builder.del

  // count() is chainable in Knex (`.count().modify().groupBy()`) yet awaitable,
  // so it flags the builder and returns it; awaiting then yields count rows.
  builder.__isCount = false
  builder.count = vi.fn(() => { builder.__isCount = true; return builder })

  const resolveValue = () => (builder.__isCount ? db.__count() : db.__rows())
  builder.then = (resolve, reject) => Promise.resolve(resolveValue()).then(resolve, reject)
  builder.catch = (fn) => Promise.resolve(resolveValue()).catch(fn)
  builder.finally = (fn) => Promise.resolve(resolveValue()).finally(fn)

  return builder
}

/** Restore the terminal `vi.fn`s of a db mock to their default resolved values. */
export function resetDbMock(db) {
  db.mockClear()
  db.raw.mockClear()
  db.__rows.mockReset().mockReturnValue([])
  db.__first.mockReset().mockReturnValue(undefined)
  db.__count.mockReset().mockReturnValue([{ total: 0, n: 0 }])
  db.__insert.mockReset().mockReturnValue([1])
  db.__update.mockReset().mockReturnValue(1)
  db.__del.mockReset().mockReturnValue(1)
}

/** Build a minimal Express-style `res` mock that records status/json/send. */
export function makeRes() {
  const res = {}
  res.statusCode = 200
  res.body = undefined
  res.status = vi.fn((code) => { res.statusCode = code; return res })
  res.json = vi.fn((payload) => { res.body = payload; return res })
  res.send = vi.fn((payload) => { res.body = payload; return res })
  return res
}

/** Build a Socket.io-style `io` mock where `io.to(room).emit(event, data)` is recorded. */
export function makeIo() {
  const emit = vi.fn()
  const to = vi.fn(() => ({ emit }))
  return { to, emit, __emit: emit, __to: to }
}
