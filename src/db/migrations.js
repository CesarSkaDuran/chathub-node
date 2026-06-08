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
      t.json('meta').nullable()
      t.timestamps(true, true)
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
      t.enum('status', ['sent', 'delivered', 'read', 'failed']).defaultTo('sent')
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

  console.log('Migraciones completadas.')
}
