import db from '../db/knex.js'

export async function stats(req, res) {
  const user  = req.user
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // Base query filtrada por rol
  function base() {
    let q = db('conversations as c').join('channels as ch', 'c.channel_id', 'ch.id')
    if (user.role === 'agent') q = q.where('ch.branch_id', user.branch_id)
    return q
  }

  const [open]       = await base().where('c.status', 'open').count('c.id as n')
  const [pending]    = await base().where('c.status', 'pending').count('c.id as n')
  const [resolved]   = await base().where('c.status', 'resolved').where('c.resolved_at', '>=', today).count('c.id as n')
  const [unassigned] = await base().whereNull('c.assigned_agent_id').whereIn('c.status', ['open', 'pending']).count('c.id as n')

  const [msgToday] = await db('messages as m')
    .join('conversations as c', 'm.conversation_id', 'c.id')
    .join('channels as ch', 'c.channel_id', 'ch.id')
    .where('m.created_at', '>=', today)
    .modify(q => { if (user.role === 'agent') q.where('ch.branch_id', user.branch_id) })
    .count('m.id as n')

  const byChannel = await db('channels as ch')
    .leftJoin('conversations as c', function () {
      this.on('c.channel_id', 'ch.id').onIn('c.status', ['open', 'pending'])
    })
    .select('ch.id', 'ch.name', 'ch.type', 'ch.status as channel_status')
    .count('c.id as open_count')
    .modify(q => { if (user.role === 'agent') q.where('ch.branch_id', user.branch_id) })
    .groupBy('ch.id')
    .orderBy('ch.name')

  res.json({
    open:            Number(open.n),
    pending:         Number(pending.n),
    resolved_today:  Number(resolved.n),
    unassigned:      Number(unassigned.n),
    messages_today:  Number(msgToday.n),
    by_channel:      byChannel,
  })
}
