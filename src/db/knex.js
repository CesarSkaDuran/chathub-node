import knex from 'knex'
import 'dotenv/config'

const db = knex({
  client: 'mysql2',
  connection: {
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME     || 'chathub',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  },
  pool: { min: 2, max: 10 },
})

export default db
