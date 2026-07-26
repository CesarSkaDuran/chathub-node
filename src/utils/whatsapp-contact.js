import { isJidUser, isLidUser, jidNormalizedUser } from '@whiskeysockets/baileys'

/**
 * Identificador de contacto a partir del remoteJid de Baileys.
 * - PN (@s.whatsapp.net): phone = dígitos, addressKey = phone
 * - LID (@lid): phone null, addressKey = jid completo (para enviar/reply)
 */
export function contactFromRemoteJid(remoteJid) {
  if (!remoteJid) return null

  const jid = jidNormalizedUser(remoteJid)

  if (isJidUser(jid)) {
    const phone = jid.split('@')[0].replace(/\D/g, '')
    if (!/^\d{10,15}$/.test(phone)) return null
    return { jid, phone, addressKey: phone }
  }

  if (isLidUser(jid)) {
    return { jid, phone: null, addressKey: jid }
  }

  return null
}

/** Parsea meta de contacto (JSON string u objeto). */
export function parseContactMeta(meta) {
  if (!meta) return {}
  if (typeof meta === 'object') return meta
  try {
    return JSON.parse(meta)
  } catch {
    return {}
  }
}

/**
 * Destino para enviar: JID completo o dígitos PN.
 * Prioriza el número de teléfono real sobre whatsapp_jid para LIDs.
 */
export function resolveOutboundTarget(rawPhone, meta) {
  const parsed = parseContactMeta(meta)
  
  // Si el phone es un número válido, usarlo directamente
  if (rawPhone) {
    const trimmed = String(rawPhone).trim()
    let digits = trimmed.replace(/@.*$/, '').replace(/\D/g, '')
    if (trimmed.startsWith('+')) {
      digits = trimmed.slice(1).replace(/\D/g, '')
    }
    if (digits.startsWith('0')) {
      digits = digits.slice(1)
    }

    // Validar que sea un número de teléfono válido
    if (/^\d{10,15}$/.test(digits)) {
      // Agregar + al número para formato internacional
      console.log(`[resolveOutboundTarget] Usando número real del phone: +${digits}`)
      return { target: '+' + digits, kind: 'phone' }
    }
  }
  
  // Solo usar whatsapp_jid si no hay número válido en phone
  if (parsed.whatsapp_jid) {
    console.log(`[resolveOutboundTarget] Usando whatsapp_jid del meta: ${parsed.whatsapp_jid}`)
    return { target: parsed.whatsapp_jid, kind: 'jid' }
  }
  
  if (!rawPhone) return null

  const trimmed = String(rawPhone).trim()
  if (trimmed.includes('@')) {
    return { target: jidNormalizedUser(trimmed), kind: 'jid' }
  }

  let digits = trimmed.replace(/@.*$/, '').replace(/\D/g, '')
  if (trimmed.startsWith('+')) {
    digits = trimmed.slice(1).replace(/\D/g, '')
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }

  if (!digits.startsWith('57') && !digits.startsWith('593') && !digits.startsWith('1')) {
    if (digits.length === 10 || digits.length === 9) {
      digits = '57' + digits
    }
  }

  if (!/^\d{10,15}$/.test(digits)) return null
  return { target: digits, kind: 'phone' }
}
