import { Hono } from 'hono'
import { Env } from '../index'
import { generateShareCertificate } from '../services/certificates'

const certificates = new Hono<{ Bindings: Env }>()

// GET /api/certificates — list current investor's certificates
certificates.get('/', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')

  const { data, error } = await supabase
    .from('share_holdings')
    .select(`
      id,
      certificate_number,
      certificate_url,
      certificate_issued_at,
      total_units,
      total_amount_invested,
      share_classes (code, name, face_value, current_price)
    `)
    .eq('investor_id', user.id)
    .not('certificate_number', 'is', null)
    .order('certificate_issued_at', { ascending: false })

  if (error) return c.json({ error: 'Failed to load certificates' }, 500)
  return c.json({ data })
})

// GET /api/certificates/:holdingId/download — signed download URL
certificates.get('/:holdingId/download', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const holdingId = c.req.param('holdingId')

  const { data: holding } = await supabase
    .from('share_holdings')
    .select('certificate_url, certificate_number, investor_id')
    .eq('id', holdingId)
    .eq('investor_id', user.id)
    .single()

  if (!holding) return c.json({ error: 'Certificate not found' }, 404)
  if (!holding.certificate_url) {
    return c.json({ error: 'Certificate not yet generated' }, 404)
  }

  const { data: signed, error } = await supabase.storage
    .from('certificates')
    .createSignedUrl(holding.certificate_url as string, 3600)

  if (error || !signed?.signedUrl) {
    return c.json({ error: 'Could not create download link' }, 500)
  }

  return c.json({
    url: signed.signedUrl,
    certificate_number: holding.certificate_number,
    expires_in: 3600,
  })
})

// POST /api/certificates/verify — public verification of signed QR payload
certificates.post('/verify', async (c) => {
  const supabase = c.get('supabase')
  const { payload } = await c.req.json()

  if (!payload || typeof payload !== 'object') {
    return c.json({ valid: false, error: 'Missing payload' }, 400)
  }

  const certNumber = payload.cert as string | undefined
  if (!certNumber) return c.json({ valid: false, error: 'No certificate number' }, 400)

  const { data: holding } = await supabase
    .from('share_holdings')
    .select(`
      certificate_number,
      total_units,
      certificate_issued_at,
      profiles (full_name, investor_id),
      share_classes (name)
    `)
    .eq('certificate_number', certNumber)
    .single()

  if (!holding) return c.json({ valid: false, error: 'Certificate not on file' }, 404)

  const profile = (holding.profiles as any) || {}
  const sc = (holding.share_classes as any) || {}
  const profileObj = Array.isArray(profile) ? profile[0] : profile
  const scObj = Array.isArray(sc) ? sc[0] : sc

  return c.json({
    valid: true,
    certificate_number: holding.certificate_number,
    units: holding.total_units,
    issued_at: holding.certificate_issued_at,
    investor: profileObj?.full_name,
    investor_id: profileObj?.investor_id,
    share_class: scObj?.name,
  })
})

// POST /api/certificates/:holdingId/regenerate — investor-triggered regenerate
certificates.post('/:holdingId/regenerate', async (c) => {
  const user = c.get('user')
  const supabase = c.get('supabase')
  const holdingId = c.req.param('holdingId')

  const { data: holding } = await supabase
    .from('share_holdings')
    .select(`
      *,
      profiles (full_name, investor_id, id_number),
      share_classes (name, face_value)
    `)
    .eq('id', holdingId)
    .eq('investor_id', user.id)
    .single()

  if (!holding) return c.json({ error: 'Holding not found' }, 404)

  const investor = holding.profiles as Record<string, unknown>
  const shareClass = holding.share_classes as Record<string, unknown>

  const pdfBytes = await generateShareCertificate({
    certificateNumber: holding.certificate_number || `KRB-${Date.now()}`,
    investorId: (investor?.investor_id as string) || '',
    investorName: (investor?.full_name as string) || '',
    idNumber: (investor?.id_number as string) || 'N/A',
    shareClass: (shareClass?.name as string) || '',
    totalUnits: holding.total_units,
    totalInvested: holding.total_amount_invested,
    faceValuePerUnit: (shareClass?.face_value as number) || 1,
    issueDate: new Date().toISOString(),
    issuedBy: 'General Manager',
    registrarName: 'Share Registrar',
  })

  const filePath = `${user.id}/${holding.certificate_number}.pdf`
  const { error: uploadErr } = await supabase.storage
    .from('certificates')
    .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadErr) return c.json({ error: 'Failed to store certificate' }, 500)

  await supabase
    .from('share_holdings')
    .update({
      certificate_url: filePath,
      certificate_issued_at: new Date().toISOString(),
    })
    .eq('id', holding.id)

  return c.json({ success: true, certificate_url: filePath })
})

export default certificates
