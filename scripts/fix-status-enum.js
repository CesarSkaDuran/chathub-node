import db from '../src/db/knex.js'

async function run() {
  try {
    await db.raw("ALTER TABLE messages MODIFY COLUMN status ENUM('pending','sent','delivered','read','failed') DEFAULT 'sent'")
    console.log('OK - columna messages.status ampliada con pending')
  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await db.destroy()
  }
}

run()
