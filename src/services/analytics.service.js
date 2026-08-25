import db from '../db/knex.js'

/**
 * Calcula métricas de conversaciones para los informes.
 *
 * - avg_response_time_seconds: tiempo promedio entre un mensaje entrante y la
 *   primera respuesta saliente del agente en la misma conversación.
 * - unanswered_conversations: conversaciones abiertas/pendientes con mensajes sin leer.
 * - received_messages: cantidad de mensajes entrantes en el rango.
 *
 * Filtros soportados: startDate, endDate, branch_id, channel_id.
 */
export async function getConversationMetrics(filters = {}) {
  // Usamos hora local (sin Z) para que coincida con el DATETIME de MySQL.
  const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null
  const endDate   = filters.endDate   ? new Date(`${filters.endDate}T00:00:00`)   : null

  // El rango de la consulta incluye todo el día final.
  const queryEnd = endDate
    ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1)
    : null

  const branchId  = filters.branch_id ? Number(filters.branch_id)   : null
  const channelId = filters.channel_id ? Number(filters.channel_id) : null

  // Base de conversaciones filtradas por sucursal y canal
  function conversationBase() {
    let q = db('conversations as c').leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    if (branchId) q = q.where('ch.branch_id', branchId)
    if (channelId) q = q.where('c.channel_id', channelId)
    return q
  }

  // Base de mensajes filtrados por el mismo rango y canales
  function messageBase() {
    let q = db('messages as m')
      .join('conversations as c', 'm.conversation_id', 'c.id')
      .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    if (branchId) q = q.where('ch.branch_id', branchId)
    if (channelId) q = q.where('c.channel_id', channelId)
    if (startDate) q = q.where('m.created_at', '>=', startDate)
    if (queryEnd) q = q.where('m.created_at', '<', queryEnd)
    return q
  }

  // ── Cantidad de mensajes recibidos ───────────────────────────────────────────
  const [{ received_messages }] = await messageBase()
    .where('m.direction', 'inbound')
    .count('m.id as received_messages')

  // ── Mensajes sin responder (conversaciones abiertas/pendientes con unread > 0) ─
  const [{ unanswered_conversations, total_unread }] = await conversationBase()
    .whereIn('c.status', ['open', 'pending'])
    .where('c.unread_count', '>', 0)
    .count('c.id as unanswered_conversations')
    .sum('c.unread_count as total_unread')

  // ── Duración promedio de respuesta ───────────────────────────────────────────
  // Para cada mensaje entrante del rango, busca el primer mensaje saliente
  // posterior de la misma conversación y promedia los segundos transcurridos.
  const [rows] = await db.raw(
    `SELECT AVG(TIMESTAMPDIFF(SECOND, m.created_at, (
      SELECT MIN(m2.created_at)
      FROM messages m2
      WHERE m2.conversation_id = m.conversation_id
        AND m2.direction = 'outbound'
        AND m2.created_at > m.created_at
        AND m2.sender_user_id IS NOT NULL
    ))) AS avg_response_time_seconds
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN channels ch ON c.channel_id = ch.id
    WHERE m.direction = 'inbound'
      ${startDate ? "AND m.created_at >= ?" : ''}
      ${queryEnd ? "AND m.created_at < ?" : ''}
      ${branchId ? "AND ch.branch_id = ?" : ''}
      ${channelId ? "AND c.channel_id = ?" : ''}`,
    [
      ...(startDate ? [startDate] : []),
      ...(queryEnd ? [queryEnd] : []),
      ...(branchId ? [branchId] : []),
      ...(channelId ? [channelId] : []),
    ]
  )
  const avg_response_time_seconds = rows?.[0]?.avg_response_time_seconds

  // ── Distribución por canal ───────────────────────────────────────────────────
  const byChannel = await messageBase()
    .where('m.direction', 'inbound')
    .select('ch.id as channel_id', 'ch.name as channel_name', 'ch.type as channel_type')
    .count('m.id as received')
    .groupBy('ch.id')
    .orderBy('received', 'desc')

  // ── Distribución por agente (mensajes enviados) ──────────────────────────────
  const byAgent = await messageBase()
    .where('m.direction', 'outbound')
    .whereNotNull('m.sender_user_id')
    .leftJoin('users as u', 'm.sender_user_id', 'u.id')
    .select('u.id as agent_id', 'u.name as agent_name')
    .count('m.id as sent')
    .groupBy('u.id')
    .orderBy('sent', 'desc')

  return {
    start_date: filters.startDate || null,
    end_date: filters.endDate || null,
    received_messages: Number(received_messages || 0),
    unanswered_conversations: Number(unanswered_conversations || 0),
    total_unread: Number(total_unread || 0),
    avg_response_time_seconds: Math.round(Number(avg_response_time_seconds || 0) || 0),
    by_channel: byChannel.map(r => ({
      ...r,
      received: Number(r.received || 0),
    })),
    by_agent: byAgent.map(r => ({
      ...r,
      sent: Number(r.sent || 0),
    })),
  }
}
