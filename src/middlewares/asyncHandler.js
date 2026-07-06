/**
 * Envuelve un controlador async para que cualquier excepcion o promesa
 * rechazada se propague al middleware de manejo de errores de Express.
 *
 * En Express 4 los rechazos de funciones async NO se capturan
 * automaticamente: la peticion queda colgada sin respuesta. Este wrapper
 * garantiza que el error llegue a `next(err)`.
 */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
