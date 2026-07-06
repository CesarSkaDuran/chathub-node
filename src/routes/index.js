import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.js'

import { login, logout, me } from '../controllers/auth.controller.js'
import { list as listConvs, show as showConv, assign, updateStatus as convStatus, markRead } from '../controllers/conversation.controller.js'
import { history, send, updateStatus as msgStatus } from '../controllers/message.controller.js'
import { list as listChannels, create as createChannel, remove as removeChannel, reconnect, getQr } from '../controllers/channel.controller.js'
import { list as listAgents, create as createAgent, update as updateAgent } from '../controllers/agent.controller.js'
import { stats } from '../controllers/dashboard.controller.js'

const router = Router()

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', login)
router.post('/auth/logout', authMiddleware, logout)
router.get('/auth/me', authMiddleware, me)

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard/stats', authMiddleware, stats)

// ── Conversaciones ────────────────────────────────────────────────────────────
router.get('/conversations',                        authMiddleware, listConvs)
router.get('/conversations/:id',                    authMiddleware, showConv)
router.put('/conversations/:id/assign',             authMiddleware, assign)
router.put('/conversations/:id/status',             authMiddleware, convStatus)
router.put('/conversations/:id/read',               authMiddleware, markRead)

// ── Mensajes ──────────────────────────────────────────────────────────────────
router.get('/conversations/:id/messages',           authMiddleware, history)
router.post('/conversations/:id/messages',          authMiddleware, send)

// ── Canales (admin / supervisor) ──────────────────────────────────────────────
router.get('/channels',                             authMiddleware, listChannels)
router.post('/channels',                            authMiddleware, requireRole('admin', 'supervisor'), createChannel)
router.delete('/channels/:id',                      authMiddleware, requireRole('admin', 'supervisor'), removeChannel)
router.post('/channels/:id/reconnect',              authMiddleware, requireRole('admin', 'supervisor'), reconnect)
router.get('/channels/:id/qr',                      authMiddleware, requireRole('admin', 'supervisor'), getQr)

// ── Agentes (admin / supervisor) ──────────────────────────────────────────────
router.get('/agents',                               authMiddleware, listAgents)
router.post('/agents',                              authMiddleware, requireRole('admin', 'supervisor'), createAgent)
router.put('/agents/:id',                           authMiddleware, requireRole('admin', 'supervisor'), updateAgent)

// ── Estado de mensajes (requiere autenticacion) ──────────────────────────────
router.post('/messages/status', authMiddleware, msgStatus)

export default router
