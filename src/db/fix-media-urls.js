import db from './knex.js'

const base = process.env.MEDIA_BASE_URL || 'http://localhost:3000'

async function run() {
  const updated = await db('messages')
    .where('media_url', 'like', '/uploads/%')
    .update({
      media_url: db.raw("CONCAT(?, media_url)", [base]),
    })
  console.log(`Actualizados ${updated} mensajes con media_url relativo -> ${base}`)
  await db.destroy()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
