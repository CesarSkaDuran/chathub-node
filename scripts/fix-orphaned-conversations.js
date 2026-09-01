/**
 * Fix orphaned conversations:
 * 1. Find the active WhatsApp channel
 * 2. Merge duplicate conversations (same contact + same LID) into one
 * 3. Re-link orphaned conversations to the active WhatsApp channel
 * 4. Move messages from duplicate/orphaned conversations to the kept one
 * 5. Delete duplicate/orphaned conversations
 *
 * Usage: node scripts/fix-orphaned-conversations.js
 */
import db from '../src/db/knex.js'

async function run() {
  // 1. Find active WhatsApp channel
  const activeChannel = await db('channels')
    .where({ type: 'whatsapp', status: 'active' })
    .first()

  if (!activeChannel) {
    console.error('No hay canal de WhatsApp activo. Cancelando.')
    process.exit(1)
  }

  console.log(`Canal activo: id=${activeChannel.id}, name="${activeChannel.name}", session_id="${activeChannel.session_id}"`)

  // 2. Get all WhatsApp conversations (orphaned + active channel)
  const allConvs = await db('conversations as c')
    .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    .join('contacts as ct', 'c.contact_id', 'ct.id')
    .select(
      'c.id', 'c.channel_id', 'c.contact_id', 'c.status', 'c.unread_count',
      'c.last_message_at', 'c.created_at',
      'ct.name as contact_name', 'ct.phone as contact_phone', 'ct.meta as contact_meta',
      'ch.name as channel_name', 'ch.status as channel_status'
    )
    .orderBy('c.id', 'asc')

  console.log(`\nTotal conversaciones: ${allConvs.length}`)

  // 3. Group by contact (using LID or phone as unique key)
  const groups = {}
  for (const conv of allConvs) {
    const meta = typeof conv.contact_meta === 'string' ? JSON.parse(conv.contact_meta) : (conv.contact_meta || {})
    const lid = meta.whatsapp_lid || meta.whatsapp_jid || null
    const phone = conv.contact_phone || null
    const key = lid || phone || `contact_${conv.contact_id}`

    if (!groups[key]) groups[key] = []
    groups[key].push(conv)
  }

  console.log(`\nGrupos unicos de contacto: ${Object.keys(groups).length}`)

  let mergedCount = 0
  let movedMessages = 0
  let relinkedCount = 0
  const toDelete = []

  for (const [key, convs] of Object.entries(groups)) {
    if (convs.length === 0) continue

    // Sort: prefer conversations already on the active channel, then most recent
    convs.sort((a, b) => {
      // Active channel first
      if (a.channel_id === activeChannel.id && b.channel_id !== activeChannel.id) return -1
      if (b.channel_id === activeChannel.id && a.channel_id !== activeChannel.id) return 1
      // Then by most recent activity
      const aDate = new Date(a.last_message_at || a.created_at).getTime()
      const bDate = new Date(b.last_message_at || b.created_at).getTime()
      return bDate - aDate
    })

    const keepConv = convs[0]
    const duplicates = convs.slice(1)

    // 4. Re-link the kept conversation to the active channel if needed
    if (keepConv.channel_id !== activeChannel.id) {
      console.log(`  [RELINK] Conv ${keepConv.id} (contact: ${keepConv.contact_name}) canal ${keepConv.channel_id} -> ${activeChannel.id}`)
      await db('conversations').where('id', keepConv.id).update({
        channel_id: activeChannel.id,
        updated_at: new Date(),
      })
      relinkedCount++
    }

    // 5. Merge duplicates: move messages to kept conversation
    for (const dup of duplicates) {
      const msgCount = await db('messages').where('conversation_id', dup.id).count('id as cnt').first()
      const count = msgCount?.cnt || 0

      if (count > 0) {
        console.log(`  [MERGE] Conv ${dup.id} -> ${keepConv.id}: moviendo ${count} mensajes`)
        await db('messages').where('conversation_id', dup.id).update({
          conversation_id: keepConv.id,
        })
        movedMessages += count
      }

      // Sum unread counts
      if (dup.unread_count > 0) {
        await db('conversations').where('id', keepConv.id).update({
          unread_count: db.raw('unread_count + ?', [dup.unread_count]),
        })
      }

      toDelete.push(dup.id)
      mergedCount++
    }
  }

  // 6. Delete duplicate conversations
  if (toDelete.length > 0) {
    console.log(`\nEliminando ${toDelete.length} conversaciones duplicadas...`)
    await db('conversations').whereIn('id', toDelete).del()
  }

  // 7. Also clean up orphaned contacts (contacts with no conversations)
  const orphanedContacts = await db('contacts as ct')
    .leftJoin('conversations as c', 'ct.id', 'c.contact_id')
    .whereNull('c.id')
    .select('ct.id', 'ct.name')
  if (orphanedContacts.length > 0) {
    console.log(`\nEliminando ${orphanedContacts.length} contactos sin conversaciones...`)
    await db('contacts').whereIn('id', orphanedContacts.map(c => c.id)).del()
  }

  console.log(`\n=== RESUMEN ===`)
  console.log(`Conversaciones re-vinculadas al canal ${activeChannel.id}: ${relinkedCount}`)
  console.log(`Conversaciones duplicadas eliminadas: ${mergedCount}`)
  console.log(`Mensajes movidos: ${movedMessages}`)
  console.log(`Contactos huerfanos eliminados: ${orphanedContacts.length}`)

  // 8. Verify final state
  const finalConvs = await db('conversations as c')
    .leftJoin('channels as ch', 'c.channel_id', 'ch.id')
    .select('c.id', 'c.channel_id', 'ch.name as channel_name', 'ch.status as channel_status')
    .orderBy('c.id')

  const orphanedFinal = finalConvs.filter(c => !c.channel_name)
  console.log(`\nConversaciones finales: ${finalConvs.length}`)
  console.log(`Conversaciones huerfanas restantes: ${orphanedFinal.length}`)

  if (orphanedFinal.length > 0) {
    console.log('  HUERFANAS:', orphanedFinal.map(c => `conv ${c.id} (channel ${c.channel_id})`).join(', '))
  }

  await db.destroy()
  console.log('\nDone!')
}

run().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
