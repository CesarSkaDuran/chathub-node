import { getConversationMetrics } from '../services/analytics.service.js'
import { askAI } from '../services/ai.service.js'

function secondsToText(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) return '0 segundos'
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.round(totalSeconds % 60)
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s || !parts.length) parts.push(`${s}s`)
  return parts.join(' ')
}

export async function metrics(req, res) {
  const { start_date, end_date, branch_id, channel_id } = req.query
  const data = await getConversationMetrics({
    startDate: start_date,
    endDate: end_date,
    branch_id,
    channel_id,
  })

  data.avg_response_time_text = secondsToText(data.avg_response_time_seconds)
  res.json(data)
}

export async function generate(req, res) {
  const { start_date, end_date, branch_id, channel_id, prompt_extra } = req.body || {}

  const metrics = await getConversationMetrics({
    startDate: start_date,
    endDate: end_date,
    branch_id,
    channel_id,
  })

  const system = `Eres un analista de servicio al cliente. Genera un informe breve, profesional y en español a partir de las métricas que te envíe el usuario. Incluye: duración promedio de respuesta, cantidad de mensajes recibidos, conversaciones sin responder, distribución por canal y por agente. Ofrece una conclusión con recomendaciones. Sé directo, sin saludos innecesarios.`

  const userPrompt = `Genera un informe ejecutivo con las siguientes métricas:

- Período: ${metrics.start_date ? metrics.start_date.slice(0, 10) : 'inicio'} a ${metrics.end_date ? metrics.end_date.slice(0, 10) : 'hoy'}
- Mensajes recibidos: ${metrics.received_messages}
- Conversaciones sin responder: ${metrics.unanswered_conversations} (total ${metrics.total_unread} mensajes no leídos)
- Duración promedio de respuesta: ${secondsToText(metrics.avg_response_time_seconds)}
- Distribución por canal: ${JSON.stringify(metrics.by_channel)}
- Distribución por agente: ${JSON.stringify(metrics.by_agent)}

${prompt_extra ? `Solicitud adicional del usuario: ${prompt_extra}` : ''}`

  try {
    const report = await askAI(system, userPrompt, {
      provider: req.body?.provider,
      model: req.body?.model,
    })

    res.json({
      metrics,
      report,
      model: req.body?.model || process.env.AI_MODEL || 'gemini-1.5-flash',
      provider: req.body?.provider || process.env.AI_PROVIDER || 'gemini',
    })
  } catch (err) {
    console.error('[Reports] Error generando informe con IA:', err.message)
    res.status(500).json({
      error: 'No se pudo generar el informe con IA',
      detail: err.message,
      metrics,
    })
  }
}
