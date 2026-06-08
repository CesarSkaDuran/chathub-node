# ChatHub API — Node.js

API multi-canal: 23 WhatsApps + Email + Instagram + WebChat  
Stack: Node.js + Express + Knex + MySQL + Socket.io + Baileys

---

## Requisitos

- Node.js 18 o superior (https://nodejs.org)
- MySQL corriendo en WAMP
- Git (opcional)

---

## Instalacion paso a paso

### 1. Crear la base de datos en WAMP

Abre phpMyAdmin (http://localhost/phpmyadmin) y ejecuta:

```sql
CREATE DATABASE chathub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Instalar dependencias

```powershell
cd chathub-api
npm install
```

### 3. Crear el archivo .env

Copia el archivo de ejemplo y edita si es necesario:

```powershell
copy .env.example .env
```

Si tu WAMP tiene password en MySQL, edita `.env` y cambia `DB_PASSWORD`.

### 4. Iniciar el servidor

```powershell
npm start
```

La primera vez el servidor:
- Crea todas las tablas automaticamente
- Crea usuarios de prueba

Deberias ver:
```
✓ MySQL conectado
  ✓ branches
  ✓ users
  ✓ channels
  ✓ contacts
  ✓ conversations
  ✓ messages
  ✓ quick_replies
Migraciones completadas.
Seed completado.
  Login: admin@chathub.com / password
✓ ChatHub API corriendo en http://localhost:3000
✓ Socket.io activo
```

### 5. Verificar que funciona

Abre en el navegador: http://localhost:3000/health

Debe responder: `{"status":"ok"}`

---

## Usuarios de prueba

| Email | Password | Rol |
|---|---|---|
| admin@chathub.com | password | Admin (ve todo) |
| supervisor@chathub.com | password | Supervisor |
| agente@chathub.com | password | Agente (solo su sucursal) |

---

## Endpoints principales

### Auth
- `POST /api/auth/login` — Login, retorna JWT token
- `GET  /api/auth/me` — Info del usuario actual
- `POST /api/auth/logout` — Logout

### Conversaciones
- `GET  /api/conversations` — Lista (con filtros: status, channel_id, search)
- `GET  /api/conversations/:id` — Detalle
- `PUT  /api/conversations/:id/assign` — Asignar agente
- `PUT  /api/conversations/:id/status` — Cambiar estado
- `PUT  /api/conversations/:id/read` — Marcar como leido

### Mensajes
- `GET  /api/conversations/:id/messages` — Historial
- `POST /api/conversations/:id/messages` — Enviar mensaje

### Canales WhatsApp
- `GET  /api/channels` — Lista de canales
- `POST /api/channels` — Crear canal (inicia sesion Baileys automaticamente)
- `POST /api/channels/:id/reconnect` — Reconectar
- `GET  /api/channels/:id/qr` — Obtener QR para escanear
- `DELETE /api/channels/:id` — Eliminar

### Agentes
- `GET  /api/agents` — Lista
- `POST /api/agents` — Crear agente
- `PUT  /api/agents/:id` — Editar

### Dashboard
- `GET  /api/dashboard/stats` — Estadisticas

---

## Eventos Socket.io (tiempo real)

El frontend Angular se conecta con el token JWT:

```javascript
const socket = io('http://localhost:3000', {
  auth: { token: 'tu-jwt-token' }
})

// Unirse a una conversacion
socket.emit('join:conversation', conversationId)

// Escuchar mensajes nuevos
socket.on('message:new', (message) => { ... })

// Escuchar actualizaciones de conversacion
socket.on('conversation:updated', (conv) => { ... })

// QR de WhatsApp al conectar un numero
socket.on('channel:qr', ({ channel_id, qr }) => { ... })

// Estado del canal WhatsApp
socket.on('channel:status', ({ channel_id, status }) => { ... })

// Indicador de escritura
socket.emit('typing:start', { conversation_id: 5 })
socket.on('typing:start', ({ user }) => { ... })
```

---

## Agregar un numero de WhatsApp

1. Crear el canal via API:
```json
POST /api/channels
{
  "branch_id": 1,
  "type": "whatsapp",
  "name": "WhatsApp Norte 1",
  "identifier": "573001234567"
}
```

2. Escuchar el evento `channel:qr` en Socket.io o consultar `GET /api/channels/:id/qr`
3. Escanear el QR con el telefono desde WhatsApp > Dispositivos vinculados
4. El canal cambia a status `active` automaticamente

---

## Para desarrollo con recarga automatica

```powershell
npm run dev
```
