import db from '../db/knex.js'
import { canAccessBranch } from '../middlewares/auth.js'

/**
 * Carga una conversacion junto con la sucursal de su canal y verifica que el
 * usuario tenga acceso. Devuelve la conversacion si tiene acceso, o null si no
 * existe. Lanza { status } para que el controller responda el codigo correcto.
 */
export async function loadAccessibleConversation(user, conversationId) {
  const conv = await db('conversations as c')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .select('c.*', 'ch.branch_id')
    .where('c.id', conversationId)
    .first()

  if (!conv) return { conv: null, error: { status: 404, message: 'Conversacion no encontrada' } }

  if (!canAccessBranch(user, conv.branch_id)) {
    return { conv: null, error: { status: 403, message: 'Sin acceso a esta conversacion' } }
  }

  return { conv, error: null }
}
