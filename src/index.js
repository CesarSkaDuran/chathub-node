import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server as SocketIO } from 'socket.io'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { resolve } from 'path'

import db from './db/knex.js'
import { runMigrations } from './db/migrations.js'
import { runSeed } from './db/seed.js'
import { restoreAllSessions } from './services/whatsapp.service.js'
import routes from './routes/index.js'

const app    = express()
const server = createServer(app)
const isDev  = process.env.NODE_ENV !== 'production'
const corsOrigin = process.env.CORS_ORIGIN || '*'
const corsOptions = {
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

const io     = new SocketIO(server, { cors: corsOptions })

// ── Stream de logs a clientes conectados (socket-tester.html) ─────────────────
const originalLog   = console.log
const originalWarn  = console.warn
const originalError = console.error

function serializeLogArgs(args) {
  return args.map(a => {
    if (typeof a === 'object') {
      try { return JSON.stringify(a) } catch { return String(a) }
    }
    return String(a)
  }).join(' ')
}

function emitServerLog(level, args) {
  const message = serializeLogArgs(args)
  const first = typeof args[0] === 'string' ? args[0] : ''
  // Emitir logs de la app (prefijo [Modulo]) y todos los errores/warnings
  if (first.startsWith('[') || level === 'warning' || level === 'error') {
    io.emit('log', { level, message, time: new Date().toISOString() })
  }
}

console.log = (...args) => {
  originalLog(...args)
  emitServerLog('log', args)
}
console.warn = (...args) => {
  originalWarn(...args)
  emitServerLog('warning', args)
}
console.error = (...args) => {
  originalError(...args)
  emitServerLog('error', args)
}

const PORT = process.env.PORT || 3000

// ── Middlewares globales ───────────────────────────────────────────────────────
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Inyectar io en cada request para que los controllers puedan emitir eventos
app.use((req, _res, next) => { req.io = io; next() })

// ── Archivos multimedia ────────────────────────────────────────────────────────
app.use('/uploads', express.static(resolve(process.env.MEDIA_DIR || './uploads')))

// ── Rutas API ─────────────────────────────────────────────────────────────────
app.use('/api', routes)

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date() }))

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  // Autenticacion JWT en WebSocket
  const token = socket.handshake.auth?.token
  if (!token) return next(new Error('Token requerido'))
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET)
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

  // Tester: unirse a una sucursal para ver conversation:updated de esa branch
  socket.on('join:branch', (branchId) => {
    socket.join(`branch_${branchId}`)
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

    if (process.env.RUN_MIGRATIONS === 'true') {
      await runMigrations()

      const [{ count }] = await db('users').count('id as count')
      if (Number(count) === 0) {
        await runSeed()
      }
    } else {
      console.log('Migraciones automáticas desactivadas')
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
