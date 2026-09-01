import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  getContentType,
  normalizeMessageContent,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import { toDataURL } from 'qrcode'
import pino from 'pino'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import db from '../db/knex.js'
import { processInboundMessage } from './inbound.service.js'
import { contactFromRemoteJid } from '../utils/whatsapp-contact.js'
import { saveMedia } from '../utils/media.js'

const logger = pino({ level: 'silent' })
const sessions = new Map() // session_id => { sock, status, channelId, reconnectAttempt }
const reconnectAttempts = new Map() // session_id => intentos
const sessionHealth = new Map() // session_id => { flapCount, openedAt }

const MAX_RECONNECT_ATTEMPTS = 10
const MAX_BACKOFF_MS = 120_000
const RESTORE_DELAY_MS = 2000
const FLAP_WINDOW_MS = 30000
const MAX_FLAPS = 3

// ── Anti-ban: control de ritmo entre envíos ──────────────
const lastSendTimes = new Map() // session_id => timestamp del último envío
const MIN_GAP_BETWEEN_SENDS = 1000   // mínimo 1s entre cada envío
const MAX_GAP_BETWEEN_SENDS = 3000   // máximo 3s de espera extra
const LONG_PAUSE_EVERY = 25          // cada 25 mensajes, pausa larga
const LONG_PAUSE_MIN_MS = 5000       // pausa larga: 5-10s
const LONG_PAUSE_MAX_MS = 10000
const sendCounters = new Map()       // session_id => contador de envíos

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, ms, operation) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} excedio ${ms / 1000}s`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

function clearSessionFolder(session_id) {
  if (!session_id) return
  const authDir = join('./sessions', session_id)
  try {
    rmSync(authDir, { recursive: true, force: true })
    console.log(`[WhatsApp] Sesión limpiada: ${session_id}`)
  } catch (err) {
    console.warn(`[WhatsApp] No se pudo limpiar sesión ${session_id}: ${err.message}`)
  }
}

function calculateBackoff(attempt) {
  const delay = 5000 * Math.pow(2, attempt - 1)
  return Math.min(delay, MAX_BACKOFF_MS)
}

function extractMessagePayload(msg) {
  const normalized = normalizeMessageContent(msg.message)
  const contentType = getContentType(normalized)
  if (!contentType) return null

  if (contentType === 'protocolMessage' || contentType === 'reactionMessage') {
    return null
  }

  const msgContent = normalized
  let msgType = 'text'
  let body = null
  let mediaUrl = null
  let mimeType = null

  if (msgContent?.conversation) {
    body = msgContent.conversation
  } else if (msgContent?.extendedTextMessage) {
    body = msgContent.extendedTextMessage.text
  } else if (msgContent?.imageMessage) {
    msgType = 'image'
    body = msgContent.imageMessage.caption || null
    mimeType = msgContent.imageMessage.mimetype
  } else if (msgContent?.audioMessage) {
    msgType = 'audio'
    mimeType = msgContent.audioMessage.mimetype
  } else if (msgContent?.videoMessage) {
    msgType = 'video'
    body = msgContent.videoMessage.caption || null
    mimeType = msgContent.videoMessage.mimetype
  } else if (msgContent?.documentMessage) {
    msgType = 'document'
    body = msgContent.documentMessage.fileName
    mimeType = msgContent.documentMessage.mimetype
  } else if (msgContent?.stickerMessage) {
    msgType = 'sticker'
  } else if (msgContent?.locationMessage) {
    msgType = 'location'
    body = `${msgContent.locationMessage.degreesLatitude},${msgContent.locationMessage.degreesLongitude}`
  } else {
    return null
  }

  if (msgType === 'text' && !body) return null

  return { msgType, body, mediaUrl, mimeType }
}

/**
 * Extrae los digitos crudos de un LID a partir de un jid tipo "123456789@lid".
 */
function extractLidDigits(jid) {
  if (!jid || !jid.includes('@lid')) return null
  const digits = jid.split('@')[0]
  return /^\d+$/.test(digits) ? digits : null
}

/**
 * Inicia una sesion Baileys para un canal WhatsApp.
 * io = instancia de Socket.io para emitir QR y eventos en tiempo real.
 */
export async function startSession(channel, io) {
  const { session_id, id: channelId } = channel

  if (sessions.has(session_id)) {
    await stopSession(session_id)
  }

  const authDir = join('./sessions', session_id)
  mkdirSync(authDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log(`[WhatsApp] Usando versión WA: ${version} (latest: ${isLatest}) para ${session_id}`)

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    fireInitQueries: true,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: randomBetween(25000, 45000), // jitter anti-ban
    defaultQueryTimeoutMs: 60000,
    shouldIgnoreJid: (jid) => jid === 'status@broadcast' || jid?.endsWith('@broadcast'),
  })

  const currentAttempt = (reconnectAttempts.get(session_id) || 0) + 1
  reconnectAttempts.set(session_id, currentAttempt)
  sessions.set(session_id, { sock, status: 'connecting', channelId, reconnectAttempt: currentAttempt })
  const health = sessionHealth.get(session_id) || { flapCount: 0, openedAt: null }
  sessionHealth.set(session_id, health)

  sock.ev.on('creds.update', async (creds) => {
    if (sessions.get(session_id)?.sock !== sock) return
    await saveCreds(creds)
  })

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (sessions.get(session_id)?.sock !== sock) return
    console.log(`[WhatsApp] Connection update - session: ${session_id}, connection: ${connection}`)

    if (qr) {
      const qrBase64 = await toDataURL(qr)
      await db('channels').where('id', channelId).update({
        status: 'connecting',
        meta: JSON.stringify({ qr: qrBase64 }),
        updated_at: new Date(),
      })
      io.emit('channel:qr', { channel_id: channelId, qr: qrBase64 })
      console.log(`[WhatsApp] QR generado para ${session_id}`)
    }

    if (connection === 'open') {
      reconnectAttempts.delete(session_id)
      const session = sessions.get(session_id)
      if (session) {
        session.status = 'active'
        session.reconnectAttempt = 0
      }
      const health = sessionHealth.get(session_id) || { flapCount: 0, openedAt: null }
      health.flapCount = 0
      health.openedAt = Date.now()
      sessionHealth.set(session_id, health)
      await db('channels').where('id', channelId).update({
        status: 'active', meta: JSON.stringify({}), updated_at: new Date(),
      })
      io.emit('channel:status', { channel_id: channelId, status: 'active' })
      console.log(`[WhatsApp] Sesion activa: ${session_id}`)
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const reason = lastDisconnect?.error?.message || 'Unknown'
      console.log(`[WhatsApp] Connection closed - session: ${session_id}, code: ${code}, reason: ${reason}`)
      if (lastDisconnect?.error) {
        console.log(`[WhatsApp] Error completo:`, JSON.stringify(lastDisconnect.error, Object.getOwnPropertyNames(lastDisconnect.error), 2))
      } else {
        console.log(`[WhatsApp] lastDisconnect sin error - raw:`, JSON.stringify(lastDisconnect))
      }

      const session = sessions.get(session_id)
      const attempt = (session?.reconnectAttempt || reconnectAttempts.get(session_id) || 0)
      sessions.delete(session_id)

      const health = sessionHealth.get(session_id) || { flapCount: 0, openedAt: null }
      const wasQuick = health.openedAt && (Date.now() - health.openedAt) < FLAP_WINDOW_MS
      health.flapCount = wasQuick ? health.flapCount + 1 : 0
      health.openedAt = null
      sessionHealth.set(session_id, health)

      const isLoggedOut = code === DisconnectReason.loggedOut || code === 401 || code === 415
      const doNotReconnect = [
        DisconnectReason.connectionReplaced,
        DisconnectReason.badSession,
        DisconnectReason.multideviceMismatch,
        DisconnectReason.forbidden,
      ].includes(code)

      // 515 = Stream Errored (restart required): WhatsApp pide reiniciar con credenciales recién guardadas
      if (code === DisconnectReason.restartRequired) {
        console.log(`[WhatsApp] Reinicio requerido por WhatsApp, reconectando con credenciales: ${session_id}`)
        reconnectAttempts.set(session_id, 0)
        setTimeout(() => startSession(channel, io), 1000)
        return
      }

      if (isLoggedOut || doNotReconnect || health.flapCount >= MAX_FLAPS) {
        clearSessionFolder(session_id)
        reconnectAttempts.delete(session_id)
        sessionHealth.delete(session_id)
        const finalStatus = isLoggedOut ? 'inactive' : 'error'
        const metaError = isLoggedOut
          ? null
          : { error: `Sesion terminada: ${reason} (code ${code})` }
        await db('channels').where('id', channelId).update({
          status: finalStatus,
          meta: metaError ? JSON.stringify(metaError) : JSON.stringify({}),
          updated_at: new Date(),
        })
        io.emit('channel:status', { channel_id: channelId, status: finalStatus })
        if (health.flapCount >= MAX_FLAPS) {
          console.log(`[WhatsApp] Sesion intermitente - limpiando y deteniendo: ${session_id}`)
        } else {
          console.log(`[WhatsApp] Sesion terminada sin reconexion (reason: ${reason}, code: ${code}): ${session_id}`)
        }
        return
      }

      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        sessionHealth.delete(session_id)
        await db('channels').where('id', channelId).update({
          status: 'error', meta: JSON.stringify({ error: 'Maximos intentos de reconexion alcanzados' }), updated_at: new Date(),
        })
        io.emit('channel:status', { channel_id: channelId, status: 'error' })
        console.log(`[WhatsApp] Maximos intentos de reconexion alcanzados: ${session_id}`)
        return
      }

      const delay = calculateBackoff(attempt + 1)
      reconnectAttempts.set(session_id, attempt + 1)

      await db('channels').where('id', channelId).update({
        status: 'error', updated_at: new Date(),
      })
      io.emit('channel:status', { channel_id: channelId, status: 'error' })

      console.log(`[WhatsApp] Reconectando ${session_id} en ${delay}ms... (intento ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`)
      setTimeout(() => startSession(channel, io), delay)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (sessions.get(session_id)?.sock !== sock) return
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue

      const jid = msg.key.remoteJid
      if (!jid) continue
      if (jid === 'status@broadcast') continue

      if (jid.endsWith('@g.us')) {
        const extracted = extractMessagePayload(msg)
        if (!extracted) continue

        let { msgType, body, mediaUrl, mimeType } = extracted

        if (['image', 'audio', 'video', 'document'].includes(msgType)) {
          try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {})
            mediaUrl = await saveMedia(buffer, mimeType, msgType)
          } catch (err) {
            console.error(`[WhatsApp] Error descargando media de grupo ${msgType}:`, err.message)
          }
        }

        let groupName = jid
        try {
          const groupMeta = await sock.groupMetadata(jid)
          if (groupMeta?.subject) groupName = groupMeta.subject
        } catch (err) {
          console.warn(`[WhatsApp] No se pudo obtener metadata del grupo ${jid}: ${err.message}`)
        }

        const participantJid = msg.key.participant || jid
        const participantPhone = participantJid.split('@')[0].replace(/\D/g, '')
        const participantName = msg.pushName || participantPhone

        console.log(`[WhatsApp] Inbound (grupo) - jid: ${jid}, grupo: ${groupName}, de: ${participantName}, tipo: ${msgType}`)

        const groupResult = await processInboundMessage(channel, {
          external_id:      msg.key.id,
          from_jid:         jid,
          is_group:         true,
          group_jid:        jid,
          group_name:       groupName,
          from_name:        groupName,
          participant_name: participantName,
          participant_jid:  participantJid,
          type:             msgType,
          body,
          media_url:        mediaUrl,
          media_mime_type:  mimeType,
        }, io)
        console.log(`[WhatsApp] Inbound grupo procesado - msgId: ${groupResult?.id ?? 'N/A'}`)
        continue
      }

      const isLid = jid.includes('@lid')

      // Baileys v6.8+/v7: cuando el chat viene direccionado por LID, el JID
      // "alterno" (numero de telefono real, si WhatsApp lo comparte) llega en
      // remoteJidAlt. YA NO usamos sock.onWhatsApp() para esto: esa funcion
      // verifica numeros, no traduce LID -> telefono, y por eso terminabamos
      // guardando el LID como si fuera el numero real.
      const realJid = isLid ? (msg.key.remoteJidAlt || null) : jid
      const hasRealPhone = !!realJid

      const contactInfo = contactFromRemoteJid(realJid || jid)
      if (!contactInfo) {
        console.log(`[WhatsApp] JID no soportado, ignorado: ${jid}`)
        continue
      }

      const lidDigits = isLid ? extractLidDigits(jid) : null

      const extracted = extractMessagePayload(msg)
      if (!extracted) continue

      let { msgType, body, mediaUrl, mimeType } = extracted

      if (['image', 'audio', 'video', 'document'].includes(msgType)) {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {})
          mediaUrl = await saveMedia(buffer, mimeType, msgType)
        } catch (err) {
          console.error(`[WhatsApp] Error descargando media ${msgType}:`, err.message)
        }
      }

      console.log(
        `[WhatsApp] Inbound - jid: ${jid}, phone: ${hasRealPhone ? contactInfo.phone : '(sin resolver, LID: ' + lidDigits + ')'}, tipo: ${msgType}`,
      )

      const inboundResult = await processInboundMessage(channel, {
        external_id:     msg.key.id,
        from_jid:        jid,
        from_phone:      hasRealPhone ? contactInfo.phone : null,
        address_key:     hasRealPhone ? contactInfo.addressKey : jid,
        lid:             lidDigits,
        is_lid_only:     isLid && !hasRealPhone,
        from_name:       msg.pushName || null,
        type:            msgType,
        body,
        media_url:       mediaUrl,
        media_mime_type: mimeType,
      }, io)
      console.log(`[WhatsApp] Inbound procesado - msgId: ${inboundResult?.id ?? 'N/A'}`)
    }
  })

  // Cuando WhatsApp comparte tardiamente el mapeo LID <-> numero real,
  // Baileys emite este evento. Lo dejamos logueado por ahora para poder
  // decidir si vale la pena usarlo para backfill de contactos existentes.
  sock.ev.on('lid-mapping.update', (mapping) => {
    if (sessions.get(session_id)?.sock !== sock) return
    console.log(`[WhatsApp] lid-mapping.update: ${JSON.stringify(mapping)}`)
  })

  sock.ev.on('message-receipt.update', async (receipts) => {
    if (sessions.get(session_id)?.sock !== sock) return
    for (const { key, receipt } of receipts) {
      const status = receipt.readTimestamp ? 'read' : 'delivered'
      await db('messages').where('external_id', key.id).update({
        status,
        read_at: status === 'read' ? new Date() : null,
        updated_at: new Date(),
      })
    }
  })

  // Diagnostico de envios: WhatsApp reporta el estado real del mensaje
  // (enviado / entregado / leido / error) via este evento, no solo el
  // ack local que devuelve sendMessage().
  sock.ev.on('messages.update', (updates) => {
    if (sessions.get(session_id)?.sock !== sock) return
    for (const { key, update } of updates) {
      if (update?.status !== undefined) {
        console.log(`[WhatsApp] messages.update - id: ${key.id}, status: ${update.status}`)
      }
    }
  })

  return sock
}

export async function stopSession(session_id) {
  const session = sessions.get(session_id)
  if (session) {
    try { session.sock.end() } catch (_) {}
    sessions.delete(session_id)
  }
  lastSendTimes.delete(session_id)
  sendCounters.delete(session_id)
}

/**
 * Envía tickets de lectura (doble check azul) al contacto en WhatsApp.
 * keys: [{ remoteJid, id, fromMe: false, participant? }]
 */
export async function markWhatsAppRead(session_id, keys) {
  const session = sessions.get(session_id)
  if (!session || session.status !== 'active') {
    throw new Error(`Sesion ${session_id} no activa`)
  }
  if (!keys?.length) return 0

  const payload = keys
    .filter(k => k?.id && k?.remoteJid)
    .map(k => ({
      remoteJid: k.remoteJid,
      id: k.id,
      fromMe: false,
      ...(k.participant ? { participant: k.participant } : {}),
    }))

  if (!payload.length) return 0

  await session.sock.readMessages(payload)
  console.log(`[WhatsApp] readMessages enviados: ${payload.length} para ${session_id}`)
  return payload.length
}

/**
 * Construye un JID valido a partir de un telefono, un JID completo
 * (@s.whatsapp.net o @lid), o digitos crudos de LID.
 * IMPORTANTE: si el destino es un LID, el llamador DEBE pasar el JID
 * completo con sufijo "@lid" (ej. "123456789@lid"). Digitos sueltos
 * sin "@" siempre se interpretan como numero de telefono.
 */
function buildJid(phoneOrJid) {
  const str = String(phoneOrJid)
  if (str.includes('@')) {
    return jidNormalizedUser(str)
  }
  return `${str.replace(/\D/g, '')}@s.whatsapp.net`
}

export async function verifyNumber(session_id, phoneOrJid) {
  const session = sessions.get(session_id)
  if (!session || session.status !== 'active') {
    throw new Error(`Sesion ${session_id} no activa`)
  }

  const jid = buildJid(phoneOrJid)

  try {
    const results = await withTimeout(session.sock.onWhatsApp(jid), 10000, 'La verificacion del numero')
    const result = results?.[0]

    if (!result) {
      return { exists: false, jid: null }
    }

    return { exists: result.exists, jid: result.jid }
  } catch (err) {
    console.error(`[WhatsApp] Error verificando número: ${err.message}`)
    throw err
  }
}

export async function sendWhatsApp(session_id, phoneOrJid, { type, body, media_url, media_mime_type }) {
  const session = sessions.get(session_id)
  if (!session || session.status !== 'active') {
    throw new Error(`Sesion ${session_id} no activa`)
  }
  const to = buildJid(phoneOrJid)

  console.log(`[WhatsApp] Enviando a ${to}, tipo: ${type}`)

  let content = {}
  switch (type) {
    case 'text':     content = { text: body }; break
    case 'image':    content = { image: { url: media_url }, caption: body }; break
    case 'audio':    content = { audio: { url: media_url }, mimetype: 'audio/mp4', ptt: false }; break
    case 'video':    content = { video: { url: media_url }, caption: body }; break
    case 'document': content = {
      document: { url: media_url },
      fileName: body || 'documento',
      mimetype: media_mime_type || 'application/octet-stream',
    }; break
    default:         content = { text: body }
  }

  try {
    await withTimeout(
      session.sock.uploadPreKeysToServerIfRequired(),
      10000,
      'La sincronizacion de claves de WhatsApp',
    )

    // ── Anti-ban: respetar gap entre envíos consecutivos ──
    const lastSent = lastSendTimes.get(session_id) || 0
    const elapsed = Date.now() - lastSent
    const minGap = randomBetween(MIN_GAP_BETWEEN_SENDS, MAX_GAP_BETWEEN_SENDS)
    if (elapsed < minGap) {
      const wait = minGap - elapsed
      console.log(`[WhatsApp] Esperando ${wait}ms antes de enviar (anti-ban)`)
      await sleep(wait)
    }

    // ── Anti-ban: pausa larga periódica ──
    const counter = (sendCounters.get(session_id) || 0) + 1
    sendCounters.set(session_id, counter)
    if (counter % LONG_PAUSE_EVERY === 0) {
      const longPause = randomBetween(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS)
      console.log(`[WhatsApp] Pausa larga anti-ban de ${longPause}ms (envío #${counter})`)
      await sleep(longPause)
    }

    // 1. Pausa inicial antes de mostrar disponible
    await sleep(randomBetween(300, 800))

    // 2. Marcar como disponible
    await session.sock.sendPresenceUpdate('available', to)

    // 3. Simular typing/recording según tipo de mensaje
    if (type === 'audio') {
      await session.sock.sendPresenceUpdate('recording', to)
    } else {
      await session.sock.sendPresenceUpdate('composing', to)
    }

    // 4. Delay proporcional al contenido (mínimo 0.5s, máximo 2s)
    const textLength = String(body || media_url || '').length
    const humanDelay = Math.min(Math.max(textLength * 20, 500), 2000)
    await sleep(humanDelay)

    // 5. Detener presencia y enviar el mensaje real
    await session.sock.sendPresenceUpdate('paused', to)

    const result = await withTimeout(session.sock.sendMessage(to, content), 20000, 'El envio del mensaje')

    lastSendTimes.set(session_id, Date.now())
    console.log(`[WhatsApp] Mensaje enviado - key: ${result?.key?.id}`)
    if (!result?.key?.id) {
      console.warn(`[WhatsApp] sendMessage no devolvio key.id - revisar messages.update para status real`)
    }
    return result?.key?.id || null
  } catch (err) {
    console.error(`[WhatsApp] Error enviando mensaje: ${err.message}`)
    throw err
  }
}

export function getSessionStatus() {
  const result = {}
  for (const [id, s] of sessions) result[id] = s.status
  return result
}

export function getSessionHealthStatus(session_id) {
  const session = sessions.get(session_id)
  const health = sessionHealth.get(session_id)
  return {
    loaded: Boolean(session),
    runtime_status: session?.status || 'inactive',
    opened_at: health?.openedAt ? new Date(health.openedAt).toISOString() : null,
    reconnect_attempts: session?.reconnectAttempt || reconnectAttempts.get(session_id) || 0,
    flap_count: health?.flapCount || 0,
  }
}

export async function restoreAllSessions(io) {
  const channels = await db('channels').where('type', 'whatsapp').whereNotNull('session_id')
  console.log(`Restaurando ${channels.length} sesiones WhatsApp...`)
  for (const ch of channels) {
    await startSession(ch, io)
    // Desincronizar arranque de múltiples cuentas para evitar picos de tráfico
    await sleep(RESTORE_DELAY_MS)
  }
}