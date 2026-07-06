import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'
import { asyncHandler } from '../middlewares/asyncHandler.js'

import { login, logout, me } from '../controllers/auth.controller.js'
import { list as listConvs, show as showConv, assign, updateStatus as convStatus, markRead } from '../controllers/conversation.controller.js'
import { history, send, updateStatus as msgStatus } from '../controllers/message.controller.js'
import { list as listChannels, create as createChannel, remove as removeChannel, reconnect, getQr } from '../controllers/channel.controller.js'
import { list as listAgents, create as createAgent, update as updateAgent } from '../controllers/agent.controller.js'
import { stats } from '../controllers/dashboard.controller.js'

const router = Router()

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', asyncHandler(login))
router.post('/auth/logout', authMiddleware, asyncHandler(logout))
router.get('/auth/me', authMiddleware, asyncHandler(me))

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard/stats', authMiddleware, asyncHandler(stats))

// ── Conversaciones ────────────────────────────────────────────────────────────
router.get('/conversations',                        authMiddleware, asyncHandler(listConvs))
router.get('/conversations/:id',                    authMiddleware, asyncHandler(showConv))
router.put('/conversations/:id/assign',             authMiddleware, asyncHandler(assign))
router.put('/conversations/:id/status',             authMiddleware, asyncHandler(convStatus))
router.put('/conversations/:id/read',               authMiddleware, asyncHandler(markRead))

// ── Mensajes ──────────────────────────────────────────────────────────────────
router.get('/conversations/:id/messages',           authMiddleware, asyncHandler(history))
router.post('/conversations/:id/messages',          authMiddleware, asyncHandler(send))

// ── Canales (admin / supervisor) ──────────────────────────────────────────────
router.get('/channels',                             authMiddleware, asyncHandler(listChannels))
router.post('/channels',                            authMiddleware, requireRole('admin', 'supervisor'), asyncHandler(createChannel))
router.delete('/channels/:id',                      authMiddleware, requireRole('admin', 'supervisor'), asyncHandler(removeChannel))
router.post('/channels/:id/reconnect',              authMiddleware, requireRole('admin', 'supervisor'), asyncHandler(reconnect))
router.get('/channels/:id/qr',                      authMiddleware, requireRole('admin', 'supervisor'), asyncHandler(getQr))

// ── Agentes (admin / supervisor) ──────────────────────────────────────────────
router.get('/agents',                               authMiddleware, asyncHandler(listAgents))
router.post('/agents',                              authMiddleware, requireRole('admin', 'supervisor'), asyncHandler(createAgent))
router.put('/agents/:id',                           authMiddleware, requireRole('admin', 'supervisor'), asyncHandler(updateAgent))

// ── Webhook interno de estado de mensajes (llamado por Baileys internamente) ──
router.post('/messages/status', asyncHandler(msgStatus))

export default router
