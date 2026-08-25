import db from './knex.js'

export async function runMigrations() {
  console.log('Ejecutando migraciones...')

  // 1. branches
  if (!await db.schema.hasTable('branches')) {
    await db.schema.createTable('branches', t => {
      t.increments('id')
      t.string('name', 100).notNullable()
      t.string('slug', 100).notNullable().unique()
      t.boolean('is_active').defaultTo(true)
      t.timestamps(true, true)
    })
    console.log('  ✓ branches')
  }

  // 2. users
  if (!await db.schema.hasTable('users')) {
    await db.schema.createTable('users', t => {
      t.increments('id')
      t.integer('branch_id').unsigned().references('id').inTable('branches').onDelete('SET NULL').nullable()
      t.string('name', 100).notNullable()
      t.string('email', 150).notNullable().unique()
      t.string('password', 255).notNullable()
      t.enum('role', ['admin', 'supervisor', 'agent']).defaultTo('agent')
      t.boolean('is_active').defaultTo(true)
      t.timestamp('last_seen_at').nullable()
      t.timestamps(true, true)
    })
    console.log('  ✓ users')
  }

  // 3. channels
  if (!await db.schema.hasTable('channels')) {
    await db.schema.createTable('channels', t => {
      t.increments('id')
      t.integer('branch_id').unsigned().references('id').inTable('branches').onDelete('CASCADE').notNullable()
      t.enum('type', ['whatsapp', 'email', 'instagram', 'webchat']).notNullable()
      t.string('name', 100).notNullable()
      t.string('identifier', 100).notNullable()
      t.string('session_id', 150).nullable()  // ID sesion Baileys
      t.enum('status', ['active', 'inactive', 'connecting', 'error']).defaultTo('inactive')
      t.json('meta').nullable()
      t.timestamps(true, true)
      t.unique(['type', 'identifier'])
    })
    console.log('  ✓ channels')
  }

  // 4. contacts
  if (!await db.schema.hasTable('contacts')) {
    await db.schema.createTable('contacts', t => {
      t.increments('id')
      t.string('name', 150).nullable()
      t.string('phone', 30).nullable().index()
      t.string('email', 150).nullable().index()
      t.string('instagram_handle', 100).nullable()
      t.string('avatar_url', 500).nullable()
      t.string('whatsapp_lid', 50).nullable().index()
      t.json('meta').nullable()
      t.timestamps(true, true)
      t.unique('phone')
      t.unique('whatsapp_lid')
    })
    console.log('  ✓ contacts')
  }

  // 5. conversations
  if (!await db.schema.hasTable('conversations')) {
    await db.schema.createTable('conversations', t => {
      t.increments('id')
      t.integer('channel_id').unsigned().references('id').inTable('channels').onDelete('CASCADE').notNullable()
      t.integer('contact_id').unsigned().references('id').inTable('contacts').onDelete('CASCADE').notNullable()
      t.integer('assigned_agent_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.enum('status', ['open', 'pending', 'resolved', 'snoozed']).defaultTo('pending')
      t.string('subject', 255).nullable()
      t.integer('unread_count').defaultTo(0)
      t.timestamp('last_message_at').nullable()
      t.timestamp('resolved_at').nullable()
      t.timestamps(true, true)
      t.index(['channel_id', 'status'])
      t.index('last_message_at')
      t.unique(['channel_id', 'contact_id'])
    })
    console.log('  ✓ conversations')
  }

  // 6. messages
  if (!await db.schema.hasTable('messages')) {
    await db.schema.createTable('messages', t => {
      t.increments('id')
      t.integer('conversation_id').unsigned().references('id').inTable('conversations').onDelete('CASCADE').notNullable()
      t.integer('sender_user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      t.enum('direction', ['inbound', 'outbound']).notNullable()
      t.enum('type', ['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'activity']).defaultTo('text')
      t.text('body').nullable()
      t.string('external_id', 100).nullable().index()
      t.string('media_url', 500).nullable()
      t.string('media_mime_type', 100).nullable()
      t.enum('status', ['pending', 'sent', 'delivered', 'read', 'failed']).defaultTo('sent')
      t.timestamp('read_at').nullable()
      t.json('meta').nullable()
      t.timestamps(true, true)
      t.index(['conversation_id', 'created_at'])
    })
    console.log('  ✓ messages')
  }

  // 7. quick_replies
  if (!await db.schema.hasTable('quick_replies')) {
    await db.schema.createTable('quick_replies', t => {
      t.increments('id')
      t.integer('branch_id').unsigned().references('id').inTable('branches').onDelete('CASCADE').nullable()
      t.string('shortcut', 50).notNullable()
      t.text('content').notNullable()
      t.timestamps(true, true)
    })
    console.log('  ✓ quick_replies')
  }

  // Migraciones incrementales para tablas existentes
  await runIncrementalMigrations()

  console.log('Migraciones completadas.')
}

async function runIncrementalMigrations() {
  // 1. Agregar columna whatsapp_lid a contacts si no existe
  if (await db.schema.hasTable('contacts') && !await db.schema.hasColumn('contacts', 'whatsapp_lid')) {
    await db.schema.table('contacts', t => {
      t.string('whatsapp_lid', 50).nullable().index()
    })
    console.log('  ✓ contacts.whatsapp_lid agregado')
  }

  // 2. Migrar whatsapp_lid desde meta a columna dedicada
  const contactsWithLid = await db('contacts')
    .whereNotNull('meta')
    .where('meta', 'like', '%"whatsapp_lid"%')
    .whereNull('whatsapp_lid')

  for (const contact of contactsWithLid) {
    try {
      const meta = typeof contact.meta === 'string' ? JSON.parse(contact.meta) : contact.meta
      if (meta.whatsapp_lid) {
        await db('contacts').where('id', contact.id).update({ whatsapp_lid: meta.whatsapp_lid })
      }
    } catch (_) {}
  }
  if (contactsWithLid.length) {
    console.log(`  ✓ Migrados ${contactsWithLid.length} whatsapp_lid desde meta`)
  }

  // 3. Agregar índice único en contacts.phone si no existe
  const phoneIndex = await getIndexInfo('contacts', 'contacts_phone_unique')
  if (!phoneIndex) {
    try {
      await db.schema.table('contacts', t => t.unique('phone'))
      console.log('  ✓ Índice único contacts.phone agregado')
    } catch (err) {
      console.warn('  ⚠ No se pudo agregar índice único contacts.phone:', err.message)
    }
  }

  // 4. Agregar índice único en contacts.whatsapp_lid si no existe
  const lidIndex = await getIndexInfo('contacts', 'contacts_whatsapp_lid_unique')
  if (!lidIndex) {
    try {
      await db.schema.table('contacts', t => t.unique('whatsapp_lid'))
      console.log('  ✓ Índice único contacts.whatsapp_lid agregado')
    } catch (err) {
      console.warn('  ⚠ No se pudo agregar índice único contacts.whatsapp_lid:', err.message)
    }
  }

  // 5. Agregar índice único en conversations (channel_id, contact_id) si no existe
  const convIndex = await getIndexInfo('conversations', 'conversations_channel_id_contact_id_unique')
  if (!convIndex) {
    try {
      await db.schema.table('conversations', t => t.unique(['channel_id', 'contact_id']))
      console.log('  ✓ Índice único conversations (channel_id, contact_id) agregado')
    } catch (err) {
      console.warn('  ⚠ No se pudo agregar índice único conversations:', err.message)
    }
  }

  // 6. Agregar columna is_group a contacts si no existe (grupos de WhatsApp)
  if (await db.schema.hasTable('contacts') && !await db.schema.hasColumn('contacts', 'is_group')) {
    await db.schema.table('contacts', t => {
      t.boolean('is_group').defaultTo(false).index()
    })
    console.log('  ✓ contacts.is_group agregado')
  }

  // 7. Ampliar ENUM de messages.status para incluir 'pending' (UI optimista)
  if (await db.schema.hasTable('messages')) {
    try {
      await db.raw("ALTER TABLE messages MODIFY COLUMN status ENUM('pending','sent','delivered','read','failed') DEFAULT 'sent'")
      console.log('  ✓ messages.status ampliado con pending')
    } catch (err) {
      console.warn('  ⚠ No se pudo ampliar messages.status:', err.message)
    }
  }
}

async function getIndexInfo(table, indexName) {
  try {
    const result = await db.raw(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName])
    return result?.[0]?.length > 0 ? result[0][0] : null
  } catch {
    return null
  }
}
