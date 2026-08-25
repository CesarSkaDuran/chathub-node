/**
 * Cliente genérico de IA para generar informes.
 *
 * Proveedores soportados (configurables por variables de entorno):
 * - gemini (por defecto): Google Gemini, API key gratuita en https://aistudio.google.com/app/apikey
 * - openrouter: OpenAI-compatible, acceso a muchos modelos gratis/de pago
 * - ollama: modelo local, requiere Ollama corriendo
 *
 * Variables de entorno:
 *   AI_PROVIDER=gemini | openrouter | ollama
 *   AI_MODEL=gemini-1.5-flash (default)
 *   AI_GEMINI_API_KEY=tu-api-key
 *   AI_OPENROUTER_API_KEY=tu-api-key
 *   AI_OPENROUTER_MODEL=openai/gpt-4o-mini (ejemplo)
 *   AI_OLLAMA_URL=http://localhost:11434
 *   AI_OLLAMA_MODEL=llama3.2 (ejemplo)
 */

const PROVIDER = process.env.AI_PROVIDER || 'gemini'

function trimText(text, max = 12000) {
  if (!text || text.length <= max) return text || ''
  return text.slice(0, max) + '\n... [contenido truncado]'
}

async function askGemini({ system, prompt, model }) {
  const apiKey = process.env.AI_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('AI_GEMINI_API_KEY no está configurada en el archivo .env')
  }

  const fullPrompt = system ? `${system}\n\n${prompt}` : prompt
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: trimText(fullPrompt) }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function askOpenRouter({ system, prompt, model }) {
  const apiKey = process.env.AI_OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('AI_OPENROUTER_API_KEY no está configurada en el archivo .env')
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.AI_HTTP_REFERER || 'http://localhost',
      'X-Title': 'ChatHub Reports',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system || 'Eres un asistente útil.' },
        { role: 'user', content: trimText(prompt) },
      ],
      temperature: 0.4,
      max_tokens: 2048,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function askOllama({ system, prompt, model, baseUrl }) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system || 'Eres un asistente útil.' },
        { role: 'user', content: trimText(prompt) },
      ],
      stream: false,
      options: { temperature: 0.4 },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return data.message?.content || ''
}

export async function askAI(system, prompt, overrides = {}) {
  const provider = overrides.provider || PROVIDER
  const model = overrides.model || process.env.AI_MODEL || 'gemini-1.5-flash-latest'

  switch (provider) {
    case 'gemini':
      return askGemini({ system, prompt, model })
    case 'openrouter': {
      const orModel = overrides.model || process.env.AI_OPENROUTER_MODEL || 'google/gemini-flash-1.5'
      return askOpenRouter({ system, prompt, model: orModel })
    }
    case 'ollama': {
      const baseUrl = overrides.baseUrl || process.env.AI_OLLAMA_URL || 'http://localhost:11434'
      const ollamaModel = overrides.model || process.env.AI_OLLAMA_MODEL || 'llama3.2'
      return askOllama({ system, prompt, model: ollamaModel, baseUrl })
    }
    default:
      throw new Error(`Proveedor de IA no soportado: ${provider}`)
  }
}
