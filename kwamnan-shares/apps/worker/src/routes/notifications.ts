import { Hono } from 'hono'
import { Env } from '../index'

const notifications = new Hono<{ Bindings: Env }>()

// GET /api/notifications
notifications.get('/', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)
  return c.json({ data })
})

// POST /api/notifications/read-all
notifications.post('/read-all', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  await supabase.from('notifications').update({ read: true, read_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('read', false)
  return c.json({ success: true })
})

// GET /api/notifications/unread-count
notifications.get('/unread-count', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const { count } = await supabase.from('notifications').select('id', { count: 'exact' })
    .eq('user_id', user.id).eq('read', false)
  return c.json({ count: count || 0 })
})

export default notifications
