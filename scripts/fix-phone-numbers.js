import db from '../src/db/knex.js'

async function fixPhoneNumbers() {
  console.log('Iniciando corrección de números de teléfono...')

  try {
    // Obtener todos los contactos
    const contacts = await db('contacts').select('*')
    console.log(`Encontrados ${contacts.length} contactos`)

    let updated = 0
    for (const contact of contacts) {
      if (!contact.phone) continue

      // Limpiar el número: remover cualquier sufijo @xxx
      const cleanPhone = contact.phone.replace(/@.*$/, '')
      
      // Si el número cambió, actualizarlo
      if (cleanPhone !== contact.phone) {
        console.log(`Actualizando contacto ${contact.id}: ${contact.phone} -> ${cleanPhone}`)
        await db('contacts').where('id', contact.id).update({ phone: cleanPhone })
        updated++
      }
    }

    console.log(`Corregidos ${updated} números de teléfono`)
    process.exit(0)
  } catch (err) {
    console.error('Error:', err)
    process.exit(1)
  }
}

fixPhoneNumbers()
