import { mkdir, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const UPLOAD_DIR = process.env.MEDIA_DIR || './uploads'
const MEDIA_BASE = process.env.MEDIA_BASE_URL || ''

const extByMime = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
}

const subfolderByType = {
  image: 'images',
  audio: 'audios',
  video: 'videos',
  document: 'documents',
}

export function getExtension(mimetype) {
  if (!mimetype) return 'bin'
  const clean = mimetype.split(';')[0].trim().toLowerCase()
  return extByMime[clean] || 'bin'
}

export function getSubfolder(type) {
  return subfolderByType[type] || 'files'
}

export async function saveMedia(buffer, mimetype, type = 'file', scope = '') {
  const parts = scope ? [scope, getSubfolder(type)] : [getSubfolder(type)]
  const dir = join(UPLOAD_DIR, ...parts)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  const id = randomUUID()
  const ext = getExtension(mimetype)
  const filename = `${id}.${ext}`
  const filepath = join(dir, filename)
  await writeFile(filepath, buffer)
  const relative = `/uploads/${[...parts, filename].join('/')}`
  return MEDIA_BASE ? `${MEDIA_BASE}${relative}` : relative
}

export async function deleteMedia(url) {
  if (!url) return false
  let pathname = url
  try {
    const u = new URL(url)
    pathname = u.pathname
  } catch {}
  const rel = pathname.replace(/^\//, '')
  if (!rel || rel.includes('..')) return false
  const filepath = join(UPLOAD_DIR, rel.replace(/^uploads\//, ''))
  try {
    await unlink(filepath)
    return true
  } catch {
    return false
  }
}
