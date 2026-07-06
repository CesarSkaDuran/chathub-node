import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server as SocketIO } from 'socket.io'
import cors from 'cors'

import db from './db/knex.js'
import { verifyToken } from './utils/auth.js'
import { runMigrations } from './db/migrations.js'
import { runSeed } from './db/seed.js'
import { restoreAllSessions } from './services/whatsapp.service.js'
import routes from './routes/index.js'

const app    = express()
const server = createServer(app)
const isDev  = process.env.NODE_ENV !== 'production'

// Fallar rapido si el secreto JWT no esta configurado o es inseguro.
const JWT_SECRET = process.env.JWT_SECRET
const WEAK_SECRETS = new Set(['', 'cambia-este-secret-en-produccion', 'secret', 'changeme'])
if (!JWT_SECRET || WEAK_SECRETS.has(JWT_SECRET) || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET no configurado o inseguro. Define un valor aleatorio de >=32 caracteres en .env')
  process.exit(1)
}

// Origenes permitidos para CORS, tomados de la config (coma-separados).
const corsOrigin = (process.env.CORS_ORIGIN || 'http://localhost:4200')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

const io     = new SocketIO(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST', 'PUT', 'DELETE'] },
})

const PORT = process.env.PORT || 3000

// ── Middlewares globales ───────────────────────────────────────────────────────
app.use(cors({ origin: corsOrigin, methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Inyectar io en cada request para que los controllers puedan emitir eventos
app.use((req, _res, next) => { req.io = io; next() })

// ── Rutas API ─────────────────────────────────────────────────────────────────
app.use('/api', routes)

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date() }))

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  // Autenticacion JWT en WebSocket
  const token = socket.handshake.auth?.token
  if (!token) return next(new Error('Token requerido'))
  try {
    socket.user = verifyToken(token)
    next()
  } catch {
    next(new Error('Token invalido'))
  }
})

io.on('connection', (socket) => {
  const user = socket.user
  console.log(`[Socket] Conectado: user ${user.id} (${user.role})`)

  // Unirse al room de su sucursal (para recibir actualizaciones de lista)
  if (user.branch_id) {
    socket.join(`branch_${user.branch_id}`)
  }

  // Supervisor/admin se unen a todas las sucursales
  if (user.role === 'admin' || user.role === 'supervisor') {
    socket.join('all_branches')
  }

  // El frontend pide unirse a una conversacion especifica
  socket.on('join:conversation', (conversationId) => {
    socket.join(`conv_${conversationId}`)
  })

  socket.on('leave:conversation', (conversationId) => {
    socket.leave(`conv_${conversationId}`)
  })

  // Indicador de escritura
  socket.on('typing:start', ({ conversation_id }) => {
    socket.to(`conv_${conversation_id}`).emit('typing:start', {
      conversation_id,
      user: { id: user.id, name: user.name },
    })
  })

  socket.on('typing:stop', ({ conversation_id }) => {
    socket.to(`conv_${conversation_id}`).emit('typing:stop', { conversation_id })
  })

  socket.on('disconnect', () => {
    console.log(`[Socket] Desconectado: user ${user.id}`)
  })
})

// ── Arranque ──────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // Verificar conexion a MySQL
    await db.raw('SELECT 1')
    console.log('✓ MySQL conectado')

    // Ejecutar migraciones
    await runMigrations()

    // Seed inicial (solo si no hay usuarios)
    const [{ count }] = await db('users').count('id as count')
    if (Number(count) === 0) {
      await runSeed()
    }

    // Iniciar servidor HTTP + WebSocket
    server.listen(PORT, () => {
      console.log(`✓ ChatHub API corriendo en http://localhost:${PORT}`)
      console.log(`✓ Socket.io activo`)
    })

    // Restaurar sesiones WhatsApp activas
    await restoreAllSessions(io)

  } catch (err) {
    console.error('Error al iniciar:', err.message)
    process.exit(1)
  }
}

bootstrap()
