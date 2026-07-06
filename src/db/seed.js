import bcrypt from 'bcryptjs'
import db from './knex.js'
import { timestamps } from '../utils/db.js'

function ago(minutes) {
  const d = new Date()
  d.setMinutes(d.getMinutes() - minutes)
  return d
}

export async function runSeed() {
  console.log('Ejecutando seed...')

  // ── 1. Sucursales ────────────────────────────────────────────────────────────
  const branchData = [
    { name: 'Sucursal Norte',  slug: 'norte'  },
    { name: 'Sucursal Sur',    slug: 'sur'    },
    { name: 'Sucursal Centro', slug: 'centro' },
  ]
  for (const b of branchData) {
    const exists = await db('branches').where('slug', b.slug).first()
    if (!exists) await db('branches').insert({ ...b, ...timestamps() })
  }
  const norte  = await db('branches').where('slug', 'norte').first()
  const sur    = await db('branches').where('slug', 'sur').first()
  const centro = await db('branches').where('slug', 'centro').first()
  console.log('  ✓ branches')

  // ── 2. Usuarios ──────────────────────────────────────────────────────────────
  const password = await bcrypt.hash('password', 10)
  const usersData = [
    { name: 'Administrador',      email: 'admin@chathub.com',       role: 'admin',      branch_id: norte.id },
    { name: 'Supervisor General', email: 'supervisor@chathub.com',  role: 'supervisor', branch_id: norte.id },
    { name: 'Agente Norte 1',     email: 'agente.norte@chathub.com',role: 'agent',      branch_id: norte.id },
    { name: 'Agente Sur 1',       email: 'agente.sur@chathub.com',  role: 'agent',      branch_id: sur.id   },
    { name: 'Agente Centro 1',    email: 'agente.centro@chathub.com',role: 'agent',     branch_id: centro.id},
  ]
  for (const u of usersData) {
    const exists = await db('users').where('email', u.email).first()
    if (!exists) await db('users').insert({ ...u, password, is_active: true, ...timestamps() })
  }
  const agentNorte  = await db('users').where('email', 'agente.norte@chathub.com').first()
  const agentSur    = await db('users').where('email', 'agente.sur@chathub.com').first()
  console.log('  ✓ users')

  // ── 3. Canales ───────────────────────────────────────────────────────────────
  const channelsData = [
    { branch_id: norte.id,  type: 'whatsapp', name: 'WhatsApp Norte 1',  identifier: '573001000001', session_id: 'session_573001000001' },
    { branch_id: norte.id,  type: 'whatsapp', name: 'WhatsApp Norte 2',  identifier: '573001000002', session_id: 'session_573001000002' },
    { branch_id: sur.id,    type: 'whatsapp', name: 'WhatsApp Sur 1',    identifier: '573002000001', session_id: 'session_573002000001' },
    { branch_id: centro.id, type: 'whatsapp', name: 'WhatsApp Centro 1', identifier: '573003000001', session_id: 'session_573003000001' },
    { branch_id: norte.id,  type: 'webchat',  name: 'Chat Web Norte',    identifier: 'webchat-norte',  session_id: null },
    { branch_id: sur.id,    type: 'email',    name: 'Email Sur',         identifier: 'ventas@empresa.com', session_id: null },
  ]
  for (const ch of channelsData) {
    const exists = await db('channels').where('identifier', ch.identifier).first()
    if (!exists) await db('channels').insert({ ...ch, status: 'inactive', ...timestamps() })
  }
  const chNorte1 = await db('channels').where('identifier', '573001000001').first()
  const chNorte2 = await db('channels').where('identifier', '573001000002').first()
  const chSur1   = await db('channels').where('identifier', '573002000001').first()
  const chEmail  = await db('channels').where('identifier', 'ventas@empresa.com').first()
  console.log('  ✓ channels')

  // ── 4. Contactos ─────────────────────────────────────────────────────────────
  const contactsData = [
    { name: 'Carlos Mendoza',   phone: '573104567890', email: null },
    { name: 'Ana Gomez',        phone: '573115678901', email: null },
    { name: 'Pedro Ramirez',    phone: '573126789012', email: null },
    { name: 'Laura Torres',     phone: '573137890123', email: null },
    { name: 'Miguel Castillo',  phone: '573148901234', email: null },
    { name: 'Sofia Herrera',    phone: '573159012345', email: null },
    { name: 'Jorge Vargas',     phone: null,           email: 'jorge.vargas@gmail.com' },
    { name: 'Diana Mora',       phone: '573170123456', email: null },
  ]
  for (const c of contactsData) {
    const where = c.phone ? { phone: c.phone } : { email: c.email }
    const exists = await db('contacts').where(where).first()
    if (!exists) await db('contacts').insert({ ...c, ...timestamps() })
  }
  const contacts = await db('contacts').orderBy('id')
  console.log('  ✓ contacts')

  // ── 5. Conversaciones y mensajes ─────────────────────────────────────────────
  const convs = [
    // Conversacion 1: abierta, asignada al agente norte
    {
      channel_id: chNorte1.id, contact: contacts[0], agent_id: agentNorte.id,
      status: 'open', minutesAgo: 5,
      messages: [
        { dir: 'inbound',  body: 'Hola, buenos dias! Queria consultar sobre el producto X', min: 30 },
        { dir: 'outbound', body: 'Claro, con mucho gusto le ayudo. ¿Qué desea saber?', min: 28 },
        { dir: 'inbound',  body: 'Cuánto cuesta y cuál es el tiempo de entrega?', min: 25 },
        { dir: 'outbound', body: 'El precio es $150.000 y la entrega es en 2 dias hábiles.', min: 20 },
        { dir: 'inbound',  body: 'Perfecto, me interesa. Cómo puedo pagar?', min: 5 },
      ]
    },
    // Conversacion 2: pendiente, sin asignar
    {
      channel_id: chNorte1.id, contact: contacts[1], agent_id: null,
      status: 'pending', minutesAgo: 12,
      messages: [
        { dir: 'inbound', body: 'Buenas tardes, necesito ayuda con mi pedido #4521', min: 12 },
        { dir: 'inbound', body: 'Me llegó incompleto', min: 10 },
      ]
    },
    // Conversacion 3: abierta en WhatsApp Norte 2
    {
      channel_id: chNorte2.id, contact: contacts[2], agent_id: agentNorte.id,
      status: 'open', minutesAgo: 45,
      messages: [
        { dir: 'inbound',  body: 'Hola! Tienen disponible la referencia AB-200?', min: 60 },
        { dir: 'outbound', body: 'Si, tenemos en stock. Son 5 unidades disponibles.', min: 55 },
        { dir: 'inbound',  body: 'Qué bien! Puedo hacer un pedido de 3?', min: 45 },
        { dir: 'outbound', body: 'Por supuesto, le genero la cotización.', min: 40 },
      ]
    },
    // Conversacion 4: resuelta
    {
      channel_id: chNorte1.id, contact: contacts[3], agent_id: agentNorte.id,
      status: 'resolved', minutesAgo: 180,
      messages: [
        { dir: 'inbound',  body: 'Hola, quiero cancelar mi suscripcion', min: 200 },
        { dir: 'outbound', body: 'Lamentamos escuchar eso. Puedo preguntar el motivo?', min: 195 },
        { dir: 'inbound',  body: 'Ya no lo necesito, gracias', min: 190 },
        { dir: 'outbound', body: 'Entendido, procesamos la cancelación. Que tenga buen dia!', min: 185 },
      ]
    },
    // Conversacion 5: sucursal sur
    {
      channel_id: chSur1.id, contact: contacts[4], agent_id: agentSur.id,
      status: 'open', minutesAgo: 8,
      messages: [
        { dir: 'inbound',  body: 'Buenos días, a qué hora abren?', min: 20 },
        { dir: 'outbound', body: 'Abrimos de lunes a viernes de 8am a 6pm y sábados de 9am a 2pm', min: 15 },
        { dir: 'inbound',  body: 'Gracias! Y tienen parqueadero?', min: 8 },
      ]
    },
    // Conversacion 6: email
    {
      channel_id: chEmail.id, contact: contacts[6], agent_id: null,
      status: 'pending', minutesAgo: 60,
      messages: [
        { dir: 'inbound', body: 'Estimados, adjunto envio solicitud de cotización para 50 unidades del producto YZ. Quedo atento. Saludos, Jorge Vargas', min: 60 },
      ]
    },
    // Conversacion 7: pendiente sin asignar sur
    {
      channel_id: chSur1.id, contact: contacts[5], agent_id: null,
      status: 'pending', minutesAgo: 3,
      messages: [
        { dir: 'inbound', body: 'Hola necesito hablar con alguien urgente', min: 3 },
      ]
    },
  ]

  for (const conv of convs) {
    const lastMsg = conv.messages[conv.messages.length - 1]
    const lastAt  = ago(lastMsg.min)

    const exists = await db('conversations')
      .where('channel_id', conv.channel_id)
      .where('contact_id', conv.contact.id)
      .first()

    if (!exists) {
      const [convId] = await db('conversations').insert({
        channel_id:        conv.channel_id,
        contact_id:        conv.contact.id,
        assigned_agent_id: conv.agent_id,
        status:            conv.status,
        unread_count:      conv.messages.filter(m => m.dir === 'inbound').length,
        last_message_at:   lastAt,
        resolved_at:       conv.status === 'resolved' ? ago(conv.minutesAgo) : null,
        created_at:        ago(conv.minutesAgo + 5),
        updated_at:        lastAt,
      })

      for (const msg of conv.messages) {
        await db('messages').insert({
          conversation_id: convId,
          sender_user_id:  msg.dir === 'outbound' ? conv.agent_id : null,
          direction:       msg.dir,
          type:            'text',
          body:            msg.body,
          status:          'delivered',
          created_at:      ago(msg.min),
          updated_at:      ago(msg.min),
        })
      }
    }
  }

  // ── 6. Respuestas rápidas de ejemplo ────────────────────────────────────────
  const quickReplies = [
    { branch_id: norte.id,  shortcut: '/saludo',   content: 'Hola! Bienvenido a ChatHub. ¿En qué le puedo ayudar hoy?' },
    { branch_id: norte.id,  shortcut: '/horario',  content: 'Nuestro horario de atención es de lunes a viernes de 8am a 6pm y sábados de 9am a 2pm.' },
    { branch_id: norte.id,  shortcut: '/despedida',content: 'Gracias por contactarnos. Ha sido un placer atenderle. ¡Que tenga un excelente día!' },
    { branch_id: null,      shortcut: '/espera',   content: 'Un momento por favor, estoy verificando esa información para usted.' },
  ]
  for (const qr of quickReplies) {
    const exists = await db('quick_replies').where('shortcut', qr.shortcut)
      .where('branch_id', qr.branch_id ?? null).first()
    if (!exists) await db('quick_replies').insert({ ...qr, ...timestamps() })
  }

  console.log('  ✓ conversations + messages')
  console.log('  ✓ quick_replies')
  console.log('')
  console.log('Seed completado. Usuarios de prueba:')
  console.log('  admin@chathub.com        / password  (Admin)')
  console.log('  supervisor@chathub.com   / password  (Supervisor)')
  console.log('  agente.norte@chathub.com / password  (Agente Norte)')
  console.log('  agente.sur@chathub.com   / password  (Agente Sur)')
}
