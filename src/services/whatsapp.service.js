import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'
import { toDataURL } from 'qrcode'
import pino from 'pino'
import { mkdirSync } from 'fs'
import db from '../db/knex.js'
import { processInboundMessage } from './inbound.service.js'
import { sessionDir } from '../utils/session-path.js'

const logger = pino({ level: 'silent' })
const sessions = new Map() // session_id => { sock, status }

/**
 * Inicia una sesion Baileys para un canal WhatsApp.
 * io = instancia de Socket.io para emitir QR y eventos en tiempo real.
 */
export async function startSession(channel, io) {
  const { session_id, id: channelId } = channel

  // Cerrar sesion previa si existe
  if (sessions.has(session_id)) {
    await stopSession(session_id)
  }

  const authDir = sessionDir(session_id)
  mkdirSync(authDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version }          = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
  })

  sessions.set(session_id, { sock, status: 'connecting', channelId })

  // ── Guardar credenciales
  sock.ev.on('creds.update', saveCreds)

  // ── Estado de conexion
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    try {
      if (qr) {
        const qrBase64 = await toDataURL(qr)
        await db('channels').where('id', channelId).update({
          status: 'connecting',
          meta: JSON.stringify({ qr: qrBase64 }),
          updated_at: new Date(),
        })
        // Emitir QR al frontend via Socket.io
        io.emit('channel:qr', { channel_id: channelId, qr: qrBase64 })
      }

      if (connection === 'open') {
        const session = sessions.get(session_id)
        if (session) session.status = 'active'
        await db('channels').where('id', channelId).update({
          status: 'active', meta: JSON.stringify({}), updated_at: new Date(),
        })
        io.emit('channel:status', { channel_id: channelId, status: 'active' })
        console.log(`[WhatsApp] Sesion activa: ${session_id}`)
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        const shouldReconnect = code !== DisconnectReason.loggedOut

        await db('channels').where('id', channelId).update({
          status: 'error', updated_at: new Date(),
        })
        io.emit('channel:status', { channel_id: channelId, status: 'error' })
        sessions.delete(session_id)

        if (shouldReconnect) {
          console.log(`[WhatsApp] Reconectando ${session_id} en 5s...`)
          setTimeout(() => {
            startSession(channel, io).catch(err => {
              console.error(`[WhatsApp] Error reconectando ${session_id}:`, err.message)
            })
          }, 5000)
        } else {
          console.log(`[WhatsApp] Sesion cerrada (logout): ${session_id}`)
        }
      }
    } catch (err) {
      console.error(`[WhatsApp] Error en connection.update (${session_id}):`, err)
    }
  })

  // ── Mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
     try {
      if (msg.key.fromMe) continue
      const jid = msg.key.remoteJid
      if (!jid || jid.endsWith('@g.us')) continue // ignorar grupos

      const phone = jid.replace('@s.whatsapp.net', '')
      const msgContent = msg.message

      let msgType = 'text', body = null, mediaUrl = null, mimeType = null

      if (msgContent?.conversation) {
        body = msgContent.conversation
      } else if (msgContent?.extendedTextMessage) {
        body = msgContent.extendedTextMessage.text
      } else if (msgContent?.imageMessage) {
        msgType = 'image'; body = msgContent.imageMessage.caption || null
        mimeType = msgContent.imageMessage.mimetype
      } else if (msgContent?.audioMessage) {
        msgType = 'audio'; mimeType = msgContent.audioMessage.mimetype
      } else if (msgContent?.videoMessage) {
        msgType = 'video'; body = msgContent.videoMessage.caption || null
      } else if (msgContent?.documentMessage) {
        msgType = 'document'; body = msgContent.documentMessage.fileName
      } else if (msgContent?.stickerMessage) {
        msgType = 'sticker'
      } else if (msgContent?.locationMessage) {
        msgType = 'location'
        body = `${msgContent.locationMessage.degreesLatitude},${msgContent.locationMessage.degreesLongitude}`
      }

      await processInboundMessage(channel, {
        external_id:     msg.key.id,
        from_phone:      phone,
        from_name:       msg.pushName || null,
        type:            msgType,
        body,
        media_url:       mediaUrl,
        media_mime_type: mimeType,
      }, io)
     } catch (err) {
      console.error(`[WhatsApp] Error procesando mensaje entrante (${session_id}):`, err)
     }
    }
  })

  // ── Actualizacion de estado (leido, entregado)
  sock.ev.on('message-receipt.update', async (receipts) => {
    for (const { key, receipt } of receipts) {
      try {
        const status = receipt.readTimestamp ? 'read' : 'delivered'
        await db('messages').where('external_id', key.id).update({
          status,
          read_at: status === 'read' ? new Date() : null,
          updated_at: new Date(),
        })
      } catch (err) {
        console.error(`[WhatsApp] Error actualizando recibo (${session_id}):`, err.message)
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
}

/**
 * Enviar mensaje saliente via Baileys.
 * Retorna el external_id (message key id) o null si falla.
 */
export async function sendWhatsApp(session_id, phone, { type, body, media_url }) {
  const session = sessions.get(session_id)
  if (!session || session.status !== 'active') {
    throw new Error(`Sesion ${session_id} no activa`)
  }

  const to = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
  let content = {}

  switch (type) {
    case 'text':     content = { text: body }; break
    case 'image':    content = { image: { url: media_url }, caption: body }; break
    case 'audio':    content = { audio: { url: media_url }, mimetype: 'audio/mp4', ptt: false }; break
    case 'video':    content = { video: { url: media_url }, caption: body }; break
    case 'document': content = { document: { url: media_url }, fileName: body }; break
    default:         content = { text: body }
  }

  const result = await session.sock.sendMessage(to, content)
  return result?.key?.id || null
}

export function getSessionStatus() {
  const result = {}
  for (const [id, s] of sessions) result[id] = s.status
  return result
}

/**
 * Restaurar todas las sesiones activas al iniciar el servidor.
 */
export async function restoreAllSessions(io) {
  const channels = await db('channels').where('type', 'whatsapp').whereNotNull('session_id')
  console.log(`Restaurando ${channels.length} sesiones WhatsApp...`)
  for (const ch of channels) {
    // Aislar cada sesion: un fallo al restaurar una no debe impedir las demas.
    try {
      await startSession(ch, io)
    } catch (err) {
      console.error(`[WhatsApp] Error restaurando sesion ${ch.session_id}:`, err.message)
    }
  }
}
