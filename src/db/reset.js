/**
 * Script para resetear y re-sembrar la BD.
 * Uso: node src/db/reset.js
 */
import db from './knex.js'
import { runMigrations } from './migrations.js'
import { runSeed } from './seed.js'

async function reset() {
  console.log('Limpiando tablas...')

  await db.raw('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of ['messages','conversations','quick_replies','contacts','channels','users','branches']) {
    await db(table).truncate()
    console.log(`  ✓ ${table} vaciada`)
  }
  await db.raw('SET FOREIGN_KEY_CHECKS = 1')

  await runMigrations()
  await runSeed()

  console.log('\nListo! Reinicia el servidor con npm start')
  process.exit(0)
}

reset().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
