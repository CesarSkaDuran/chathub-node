# Reglas de Uso - ChatHub WhatsApp

Reglas que deben seguir todos los usuarios del sistema para evitar bloqueos de las cuentas de WhatsApp.

## 1. Usar solo números WhatsApp Business

No vincular números personales al sistema. La aplicación está diseñada para funcionar con cuentas comerciales verificadas por WhatsApp.

## 2. Responder, no iniciar conversaciones masivas

Enviar mensajes solo como respuesta a clientes que ya escribieron previamente. No usar el sistema para campañas, publicidad o difusión masiva.

## 3. No enviar el mismo texto a muchos contactos seguidos

Varias las respuestas. Evitar copiar y pegar el mismo mensaje decenas de veces. Los textos idénticos enviados a muchos contactos son detectados como spam.

## 4. No hacer verificación masiva de números

No usar la función de verificar si un número tiene WhatsApp para listas grandes. Esa práctica levanta sospechas de recolección no autorizada.

## 5. Escanear el QR una sola vez por canal

Si el canal se desconecta, usar la reconexión solo cuando sea necesario. No borrar y regenerar sesiones constantemente.

## 6. No compartir la sesión con otros dispositivos

Si se escanea el QR en el servidor, no usar ese mismo WhatsApp Web en otro dispositivo o navegador al mismo tiempo.

## 7. Permitir tiempos naturales entre mensajes

El sistema ya simula escritura humana. No acelerar ni enviar varios mensajes seguidos de forma manual.

## 8. No desconectar/reconectar repetidamente

Si el canal falla, dejar que el sistema reconecte solo usando backoff exponencial. No forzar reconexiones una y otra vez.

## 9. Usar números con antigüedad

Preferir números que ya se venían usando normalmente. Los números recién comprados o creados el mismo día son sancionados más rápido.

## 10. Reportar desconexiones inmediatamente

Si un canal cae muchas veces seguidas, contactar soporte antes de seguir forzando reconexiones. El sistema limita automáticamente los intentos para proteger la cuenta.

---

**Nota técnica:** El sistema implementa medidas anti-spam como simulación de presencia humana al enviar, backoff exponencial en reconexiones, limpieza automática de credenciales inválidas y desincronización al iniciar múltiples cuentas. Aun así, el uso correcto por parte del usuario es la mejor protección contra bloqueos.
