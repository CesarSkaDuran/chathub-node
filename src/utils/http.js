/**
 * Valida que los campos requeridos esten presentes en el body.
 * Si falta alguno responde 400 y retorna false; si todo esta OK retorna true.
 */
export function validateRequired(res, source, fields, message) {
  const missing = fields.filter(f => {
    const v = source[f]
    return v === undefined || v === null || v === ''
  })
  if (missing.length) {
    res.status(400).json({ error: message || `Campos requeridos: ${missing.join(', ')}` })
    return false
  }
  return true
}

/**
 * Extrae parametros de paginacion de req.query respetando valores por defecto.
 */
export function getPagination(query, { page: defaultPage = 1, limit: defaultLimit = 25 } = {}) {
  const page  = Number(query.page  ?? defaultPage)
  const limit = Number(query.limit ?? defaultLimit)
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

/**
 * Envuelve una respuesta paginada en el formato estandar del API.
 */
export function paginated(data, total, page, limit) {
  return { data, total: Number(total), page, limit }
}
