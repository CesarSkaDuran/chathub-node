import db from '../db/knex.js'

/**
 * Columnas de timestamp para un INSERT nuevo.
 * Uso: db('tabla').insert({ ...campos, ...timestamps() })
 */
export function timestamps() {
  const now = new Date()
  return { created_at: now, updated_at: now }
}

/**
 * Agrega updated_at a un objeto de UPDATE.
 * Uso: db('tabla').where(...).update(touch({ status }))
 */
export function touch(fields = {}) {
  return { ...fields, updated_at: new Date() }
}

/**
 * Restringe una query al branch del usuario cuando su rol es 'agent'.
 * Admin y supervisor ven todo.
 */
export function scopeByBranch(query, user, column = 'branch_id') {
  if (user.role === 'agent') return query.where(column, user.branch_id)
  return query
}

/**
 * Busca un registro por su id. Retorna undefined si no existe.
 */
export function findById(table, id) {
  return db(table).where('id', id).first()
}
