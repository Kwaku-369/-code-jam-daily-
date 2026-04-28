// PDF Certificate Generation using pdf-lib (Edge-compatible, no WASM)
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'

const COLORS = {
  forestGreen: rgb(0.102, 0.361, 0.220),   // #1A5C38
  gold: rgb(0.831, 0.686, 0.216),          // #D4AF37
  deepGold: rgb(0.722, 0.525, 0.043),      // #B88609
  cream: rgb(0.980, 0.980, 0.969),         // #FAFAF7
  charcoal: rgb(0.110, 0.110, 0.110),      // #1C1C1C
  midGrey: rgb(0.45, 0.45, 0.45),
  lightGrey: rgb(0.85, 0.85, 0.85),
  white: rgb(1, 1, 1),
}

export type CertificateData = {
  certificateNumber: string
  investorId: string
  investorName: string
  idNumber: string
  shareClass: string
  totalUnits: number
  totalInvested: number
  faceValuePerUnit: number
  issueDate: string    // ISO date string
  issuedBy: string     // Bank officer name
  registrarName: string
}

export async function generateShareCertificate(data: CertificateData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([842, 595]) // A4 landscape
  const { width, height } = page.getSize()

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman)
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)

  // ── Background ────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width, height, color: COLORS.cream })

  // ── Outer border (double line) ─────────────────────────────
  const border = 15
  page.drawRectangle({
    x: border, y: border,
    width: width - border * 2, height: height - border * 2,
    borderColor: COLORS.forestGreen, borderWidth: 3,
  })
  page.drawRectangle({
    x: border + 6, y: border + 6,
    width: width - border * 2 - 12, height: height - border * 2 - 12,
    borderColor: COLORS.gold, borderWidth: 1.5,
  })

  // ── Corner decorations ────────────────────────────────────
  const corners = [
    { x: border + 2, y: border + 2 },
    { x: width - border - 22, y: border + 2 },
    { x: border + 2, y: height - border - 22 },
    { x: width - border - 22, y: height - border - 22 },
  ]
  corners.forEach(({ x, y }) => {
    page.drawRectangle({ x, y, width: 20, height: 20, color: COLORS.gold, opacity: 0.6 })
  })

  // ── Header banner ─────────────────────────────────────────
  page.drawRectangle({ x: border + 8, y: height - 130, width: width - border * 2 - 16, height: 105, color: COLORS.forestGreen })

  // Bank name
  page.drawText('KWAMNAN RURAL BANK', {
    x: width / 2 - 175, y: height - 75,
    size: 28, font: helveticaBold, color: COLORS.gold,
  })
  page.drawText('Share Certificate', {
    x: width / 2 - 95, y: height - 108,
    size: 20, font: timesRoman, color: COLORS.cream,
  })

  // ── Certificate number (top right) ───────────────────────
  page.drawText(`Certificate No: ${data.certificateNumber}`, {
    x: width - 280, y: height - 155,
    size: 10, font: helveticaBold, color: COLORS.forestGreen,
  })

  // ── Main body ─────────────────────────────────────────────
  const bodyY = height - 200

  page.drawText('This is to certify that:', {
    x: 60, y: bodyY,
    size: 12, font: helvetica, color: COLORS.midGrey,
  })

  // Investor name (large, prominent)
  page.drawText(data.investorName.toUpperCase(), {
    x: 60, y: bodyY - 35,
    size: 22, font: timesBold, color: COLORS.forestGreen,
  })

  // Underline
  const nameWidth = timesBold.widthOfTextAtSize(data.investorName.toUpperCase(), 22)
  page.drawLine({
    start: { x: 60, y: bodyY - 40 }, end: { x: 60 + nameWidth, y: bodyY - 40 },
    thickness: 1.5, color: COLORS.gold,
  })

  page.drawText(`Investor ID: ${data.investorId}  |  National ID: ${data.idNumber}`, {
    x: 60, y: bodyY - 60,
    size: 10, font: helvetica, color: COLORS.midGrey,
  })

  // Shares info
  const shareInfoY = bodyY - 100
  page.drawText('is the registered holder of', {
    x: 60, y: shareInfoY,
    size: 12, font: helvetica, color: COLORS.charcoal,
  })

  page.drawText(`${data.totalUnits.toLocaleString()} Units`, {
    x: 60, y: shareInfoY - 30,
    size: 28, font: timesBold, color: COLORS.forestGreen,
  })
  page.drawText(`of ${data.shareClass} of Kwamnan Rural Bank Limited`, {
    x: 60, y: shareInfoY - 55,
    size: 13, font: timesRoman, color: COLORS.charcoal,
  })

  page.drawText(`at a face value of GHS ${data.faceValuePerUnit.toFixed(2)} per unit`, {
    x: 60, y: shareInfoY - 75,
    size: 11, font: helvetica, color: COLORS.midGrey,
  })

  // Total investment box
  page.drawRectangle({
    x: 60, y: shareInfoY - 135, width: 220, height: 45,
    color: COLORS.forestGreen,
  })
  page.drawText('Total Investment', {
    x: 72, y: shareInfoY - 105, size: 9, font: helvetica, color: COLORS.cream,
  })
  page.drawText(`GHS ${data.totalInvested.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`, {
    x: 72, y: shareInfoY - 122, size: 16, font: helveticaBold, color: COLORS.gold,
  })

  // Issue date box
  page.drawRectangle({
    x: 295, y: shareInfoY - 135, width: 160, height: 45,
    color: COLORS.gold, opacity: 0.15, borderColor: COLORS.gold, borderWidth: 1,
  })
  page.drawText('Date of Issue', {
    x: 307, y: shareInfoY - 105, size: 9, font: helvetica, color: COLORS.midGrey,
  })
  const issueDate = new Date(data.issueDate)
  page.drawText(issueDate.toLocaleDateString('en-GH', { day: '2-digit', month: 'long', year: 'numeric' }), {
    x: 307, y: shareInfoY - 122, size: 11, font: helveticaBold, color: COLORS.charcoal,
  })

  // ── Signatures ───────────────────────────────────────────
  const sigY = 80
  // Line 1
  page.drawLine({ start: { x: 60, y: sigY }, end: { x: 220, y: sigY }, thickness: 1, color: COLORS.midGrey })
  page.drawText('Registrar', { x: 110, y: sigY - 15, size: 9, font: helvetica, color: COLORS.midGrey })
  page.drawText(data.registrarName, { x: 70, y: sigY + 8, size: 10, font: helveticaBold, color: COLORS.charcoal })

  // Line 2
  page.drawLine({ start: { x: width / 2 - 80, y: sigY }, end: { x: width / 2 + 80, y: sigY }, thickness: 1, color: COLORS.midGrey })
  page.drawText('Bank Secretary', { x: width / 2 - 45, y: sigY - 15, size: 9, font: helvetica, color: COLORS.midGrey })
  page.drawText(data.issuedBy, { x: width / 2 - 40, y: sigY + 8, size: 10, font: helveticaBold, color: COLORS.charcoal })

  // Line 3 (Bank stamp area)
  page.drawRectangle({
    x: width - 200, y: sigY - 20, width: 160, height: 60,
    borderColor: COLORS.gold, borderWidth: 1, color: COLORS.white, opacity: 0,
  })
  page.drawText('OFFICIAL BANK SEAL', {
    x: width - 185, y: sigY + 10, size: 8, font: helvetica, color: COLORS.lightGrey,
  })

  // ── Footer notice ────────────────────────────────────────
  page.drawText(
    'This certificate is issued under the Companies Act 2019 (Act 992) and is a legal document of share ownership. ' +
    'Any transfer must be registered with the bank.',
    { x: 60, y: 45, size: 7.5, font: helvetica, color: COLORS.midGrey, maxWidth: width - 120 }
  )

  // ── Watermark ─────────────────────────────────────────────
  page.drawText('KWAMNAN RURAL BANK', {
    x: 150, y: 250, size: 55, font: helveticaBold,
    color: COLORS.forestGreen, opacity: 0.04,
    rotate: degrees(35),
  })

  pdfDoc.setTitle(`Share Certificate - ${data.investorName}`)
  pdfDoc.setAuthor('Kwamnan Rural Bank')
  pdfDoc.setSubject(`${data.totalUnits} units of ${data.shareClass}`)
  pdfDoc.setCreationDate(new Date())

  return pdfDoc.save()
}
