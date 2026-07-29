import { runMigrations } from './migrations.js'
import db from './knex.js'

runMigrations()
  .then(() => db.destroy())
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
