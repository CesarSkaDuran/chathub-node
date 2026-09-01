import { Router } from 'express'
import multer from 'multer'
import { authMiddleware, requireRole } from '../middlewares/auth.js'

import { login, logout, me } from '../controllers/auth.controller.js'
import { list as listConvs, show as showConv, assign, updateStatus as convStatus, markRead, remove as removeConv, countsByChannel } from '../controllers/conversation.controller.js'
import { history, send, uploadAndSend, updateStatus as msgStatus, removeMedia } from '../controllers/message.controller.js'
import { list as listChannels, create as createChannel, update as updateChannel, remove as removeChannel, reconnect, getQr, health as channelHealth, repair as repairChannel } from '../controllers/channel.controller.js'
import { list as listAgents, create as createAgent, update as updateAgent } from '../controllers/agent.controller.js'
import { list as listQuickReplies, create as createQuickReply, update as updateQuickReply, remove as removeQuickReply } from '../controllers/quick-reply.controller.js'
import { stats } from '../controllers/dashboard.controller.js'
import { metrics as reportMetrics, generate as reportGenerate } from '../controllers/reports.controller.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', login)
router.post('/auth/logout', authMiddleware, logout)
router.get('/auth/me', authMiddleware, me)

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard/stats', authMiddleware, stats)

// ── Informes con IA ───────────────────────────────────────────────────────────
router.get('/reports/metrics', authMiddleware, reportMetrics)
router.post('/reports/generate', authMiddleware, reportGenerate)

// ── Conversaciones ────────────────────────────────────────────────────────────
router.get('/conversations',                        authMiddleware, listConvs)
router.get('/conversations/counts-by-channel',      authMiddleware, countsByChannel)
router.get('/conversations/:id',                    authMiddleware, showConv)
router.put('/conversations/:id/assign',             authMiddleware, assign)
router.put('/conversations/:id/status',             authMiddleware, convStatus)
router.put('/conversations/:id/read',               authMiddleware, markRead)
router.delete('/conversations/:id',                 authMiddleware, requireRole('admin'), removeConv)

// ── Mensajes ──────────────────────────────────────────────────────────────────
router.get('/conversations/:id/messages',           authMiddleware, history)
router.post('/conversations/:id/messages',          authMiddleware, send)
router.post('/conversations/:id/messages/upload',   authMiddleware, upload.single('file'), uploadAndSend)

// ── Canales (admin / supervisor) ──────────────────────────────────────────────
router.get('/channels',                             authMiddleware, listChannels)
router.post('/channels',                            authMiddleware, requireRole('admin', 'supervisor'), createChannel)
router.put('/channels/:id',                         authMiddleware, requireRole('admin', 'supervisor'), updateChannel)
router.delete('/channels/:id',                      authMiddleware, requireRole('admin', 'supervisor'), removeChannel)
router.post('/channels/:id/reconnect',              authMiddleware, requireRole('admin', 'supervisor'), reconnect)
router.get('/channels/:id/qr',                      authMiddleware, requireRole('admin', 'supervisor'), getQr)
router.get('/channels/:id/health',                  authMiddleware, requireRole('admin', 'supervisor'), channelHealth)
router.post('/channels/:id/repair',                 authMiddleware, requireRole('admin', 'supervisor'), repairChannel)

// ── Agentes (admin / supervisor) ──────────────────────────────────────────────
router.get('/agents',                               authMiddleware, listAgents)
router.post('/agents',                              authMiddleware, requireRole('admin', 'supervisor'), createAgent)
router.put('/agents/:id',                           authMiddleware, requireRole('admin', 'supervisor'), updateAgent)

// ── Respuestas rápidas ────────────────────────────────────────────────────────
router.get('/quick-replies',                        authMiddleware, listQuickReplies)
router.post('/quick-replies',                       authMiddleware, requireRole('admin', 'supervisor'), createQuickReply)
router.put('/quick-replies/:id',                    authMiddleware, requireRole('admin', 'supervisor'), updateQuickReply)
router.delete('/quick-replies/:id',                 authMiddleware, requireRole('admin', 'supervisor'), removeQuickReply)

// ── Mensajes multimedia ────────────────────────────────────────────────────────
router.delete('/messages/:id/media', authMiddleware, removeMedia)

// ── Webhook interno de estado de mensajes (llamado por Baileys internamente) ──
router.post('/messages/status', msgStatus)

export default router
