/**
 * Middleware centralizado de manejo de errores.
 * Debe registrarse DESPUES de todas las rutas.
 *
 * Registra el error completo (con stack) en el servidor y responde al
 * cliente con un JSON consistente, sin filtrar detalles internos en
 * produccion.
 */
export function errorHandler(err, req, res, next) {
  // Si ya se empezaron a enviar headers, delegar al handler por defecto
  // de Express para que cierre la conexion correctamente.
  if (res.headersSent) {
    return next(err)
  }

  const status = err.status || err.statusCode || 500
  const isServerError = status >= 500

  if (isServerError) {
    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err)
  }

  const isDev = process.env.NODE_ENV !== 'production'
  const body = {
    error: isServerError && !isDev ? 'Error interno del servidor' : err.message,
  }
  if (isDev && isServerError) body.stack = err.stack

  res.status(status).json(body)
}

/**
 * Middleware 404 para rutas no encontradas dentro de /api.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado' })
}
