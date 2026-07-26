import db from '../src/db/knex.js'

/**
 * Fusiona contactos duplicados en la base de datos.
 * - Agrupa por phone (no null)
 * - Agrupa por whatsapp_lid en meta
 * - Mantiene el contacto más antiguo, fusiona meta y mueve conversaciones/mensajes
 * - Elimina los duplicados
 */
async function deduplicateContacts() {
  console.log('[Deduplicate] Iniciando limpieza de contactos duplicados...')

  const trx = await db.transaction()

  try {
    // 1. Fusionar contactos duplicados por número de teléfono
    const phoneGroups = await trx('contacts')
      .select('phone')
      .whereNotNull('phone')
      .groupBy('phone')
      .havingRaw('COUNT(*) > 1')

    console.log(`[Deduplicate] Encontrados ${phoneGroups.length} teléfonos duplicados`)

    for (const { phone } of phoneGroups) {
      const duplicates = await trx('contacts')
        .where('phone', phone)
        .orderBy('created_at', 'asc')

      const [primary, ...rest] = duplicates
      console.log(`[Deduplicate] Teléfono ${phone}: ${duplicates.length} duplicados, primario ${primary.id}`)

      // Fusionar meta
      const mergedMeta = { ...parseMeta(primary.meta) }
      for (const dup of rest) {
        Object.assign(mergedMeta, parseMeta(dup.meta))
      }

      if (Object.keys(mergedMeta).length) {
        await trx('contacts').where('id', primary.id).update({
          meta: JSON.stringify(mergedMeta),
          updated_at: new Date(),
        })
      }

      // Actualizar conversaciones y mensajes
      for (const dup of rest) {
        const conversations = await trx('conversations').where('contact_id', dup.id)
        for (const conv of conversations) {
          // Verificar si ya existe una conversación para este contacto y canal
          const existingConv = await trx('conversations')
            .where('contact_id', primary.id)
            .where('channel_id', conv.channel_id)
            .first()

          if (existingConv) {
            // Mover mensajes a la conversación existente
            await trx('messages').where('conversation_id', conv.id).update({
              conversation_id: existingConv.id,
              updated_at: new Date(),
            })
            // Eliminar conversación duplicada
            await trx('conversations').where('id', conv.id).del()
          } else {
            await trx('conversations').where('id', conv.id).update({
              contact_id: primary.id,
              updated_at: new Date(),
            })
          }
        }

        // Eliminar contacto duplicado
        await trx('contacts').where('id', dup.id).del()
        console.log(`[Deduplicate] Eliminado contacto duplicado ${dup.id}`)
      }
    }

    // 2. Fusionar contactos duplicados por LID en meta
    const contactsWithLid = await trx('contacts')
      .where('meta', 'like', '%"whatsapp_lid"%')

    const lidGroups = new Map()
    for (const contact of contactsWithLid) {
      const meta = parseMeta(contact.meta)
      const lid = meta.whatsapp_lid
      if (lid) {
        if (!lidGroups.has(lid)) lidGroups.set(lid, [])
        lidGroups.get(lid).push(contact)
      }
    }

    let lidDuplicateCount = 0
    for (const [lid, duplicates] of lidGroups) {
      if (duplicates.length <= 1) continue

      lidDuplicateCount++
      duplicates.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      const [primary, ...rest] = duplicates

      // Preferir el contacto que tenga teléfono real
      const withPhone = duplicates.find(c => c.phone)
      const finalPrimary = withPhone || primary
      const toMerge = duplicates.filter(c => c.id !== finalPrimary.id)

      console.log(`[Deduplicate] LID ${lid}: ${duplicates.length} duplicados, primario ${finalPrimary.id}`)

      const mergedMeta = { ...parseMeta(finalPrimary.meta) }
      for (const dup of toMerge) {
        Object.assign(mergedMeta, parseMeta(dup.meta))
      }

      if (Object.keys(mergedMeta).length) {
        await trx('contacts').where('id', finalPrimary.id).update({
          meta: JSON.stringify(mergedMeta),
          updated_at: new Date(),
        })
      }

      for (const dup of toMerge) {
        const conversations = await trx('conversations').where('contact_id', dup.id)
        for (const conv of conversations) {
          const existingConv = await trx('conversations')
            .where('contact_id', finalPrimary.id)
            .where('channel_id', conv.channel_id)
            .first()

          if (existingConv) {
            await trx('messages').where('conversation_id', conv.id).update({
              conversation_id: existingConv.id,
              updated_at: new Date(),
            })
            await trx('conversations').where('id', conv.id).del()
          } else {
            await trx('conversations').where('id', conv.id).update({
              contact_id: finalPrimary.id,
              updated_at: new Date(),
            })
          }
        }

        await trx('contacts').where('id', dup.id).del()
        console.log(`[Deduplicate] Eliminado contacto LID duplicado ${dup.id}`)
      }
    }

    console.log(`[Deduplicate] Encontrados ${lidDuplicateCount} LIDs duplicados`)

    // 3. Fusionar conversaciones duplicadas para el mismo contacto y canal
    const convGroups = await trx('conversations')
      .select('contact_id', 'channel_id')
      .groupBy('contact_id', 'channel_id')
      .havingRaw('COUNT(*) > 1')

    console.log(`[Deduplicate] Encontradas ${convGroups.length} conversaciones duplicadas`)

    for (const { contact_id, channel_id } of convGroups) {
      const duplicates = await trx('conversations')
        .where('contact_id', contact_id)
        .where('channel_id', channel_id)
        .orderBy('created_at', 'asc')

      const [primary, ...rest] = duplicates
      console.log(`[Deduplicate] Conversación duplicada contacto ${contact_id} canal ${channel_id}: ${duplicates.length}, primaria ${primary.id}`)

      for (const dup of rest) {
        await trx('messages').where('conversation_id', dup.id).update({
          conversation_id: primary.id,
          updated_at: new Date(),
        })
        await trx('conversations').where('id', dup.id).del()
      }
    }

    await trx.commit()
    console.log('[Deduplicate] Limpieza completada exitosamente')
  } catch (err) {
    await trx.rollback()
    console.error('[Deduplicate] Error:', err.message)
    throw err
  } finally {
    await db.destroy()
  }
}

function parseMeta(meta) {
  if (!meta) return {}
  if (typeof meta === 'object') return meta
  try {
    return JSON.parse(meta)
  } catch {
    return {}
  }
}

deduplicateContacts().catch(err => {
  console.error(err)
  process.exit(1)
})
