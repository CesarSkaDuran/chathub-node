import { join, resolve } from 'path'

const SESSIONS_ROOT = resolve('./sessions')

/**
 * Resuelve de forma segura el directorio de una sesion Baileys, evitando
 * path traversal (p.ej. session_id con "../"). Lanza si el resultado queda
 * fuera de la carpeta ./sessions.
 */
export function sessionDir(sessionId) {
  if (!sessionId || !/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error('session_id invalido')
  }
  const dir = resolve(join(SESSIONS_ROOT, sessionId))
  if (dir !== SESSIONS_ROOT && !dir.startsWith(SESSIONS_ROOT + '/')) {
    throw new Error('session_id fuera de rango')
  }
  return dir
}
