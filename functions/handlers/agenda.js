/**
 * Agenda Cloud Functions
 * - icalFeed: HTTPS function that returns a .ics calendar feed for a provider
 * - autoReminder: Cron function that sends email reminders before bookings
 */

const { functions, db, admin } = require('../config');

// ── iCal Feed ─────────────────────────────────────────────────────────────────

/**
 * GET /icalFeed?uid=<providerId>&token=<icalToken>
 * Returns an iCalendar (.ics) file with all upcoming bookings for the provider.
 * The token is validated against the provider's stored icalToken.
 */
exports.icalFeed = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }

  const { uid, token } = req.query
  if (!uid || !token) {
    res.status(400).send('Missing uid or token')
    return
  }

  try {
    const db = admin.firestore()

    // Validate token
    const schedSnap = await db.doc(`provider_schedules/${uid}`).get()
    if (!schedSnap.exists || schedSnap.data().icalToken !== token) {
      res.status(403).send('Invalid token')
      return
    }

    // Get provider info
    const userSnap = await db.doc(`users/${uid}`).get()
    const providerName = userSnap.exists ? userSnap.data().displayName : 'Proveedor'

    // Get upcoming bookings (not cancelled)
    const bookingsSnap = await db.collection('bookings')
      .where('providerId', '==', uid)
      .get()

    const bookings = bookingsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => !['cancelled'].includes(b.status))

    // Build iCal
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//ServiGo//Agenda ${providerName}//ES`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:ServiGo — ${providerName}`,
      'X-WR-TIMEZONE:America/Santiago',
    ]

    for (const b of bookings) {
      try {
        const date = b.scheduledDate // YYYY-MM-DD
        const time = b.scheduledTime || '09:00' // HH:MM
        const [h, m] = time.split(':').map(Number)
        const duration = b.serviceDuration || 60

        const startDt = new Date(`${date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`)
        const endDt   = new Date(startDt.getTime() + duration * 60000)

        const toIcalDate = (dt) => {
          const pad = n => String(n).padStart(2, '0')
          return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
        }

        const statusMap = {
          pending_confirmation: 'Pendiente confirmación',
          confirmed: 'Confirmado',
          payment_held: 'Pago retenido',
          in_progress: 'En progreso',
          completed_pending_release: 'Completado — liberando fondos',
          completed: 'Completado',
        }

        lines.push('BEGIN:VEVENT')
        const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT || 'servigo'
        lines.push(`UID:servigo-${b.id}@${projectId}`)
        lines.push(`DTSTART:${toIcalDate(startDt)}`)
        lines.push(`DTEND:${toIcalDate(endDt)}`)
        lines.push(`SUMMARY:${b.serviceTitle || 'Reserva'} — ${b.clientName || ''}`)
        lines.push(`DESCRIPTION:Cliente: ${b.clientName}\\nEstado: ${statusMap[b.status] || b.status}\\nTotal: $${(b.totalPrice || 0).toLocaleString('es-CL')}`)
        lines.push(`STATUS:${b.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`)
        lines.push('END:VEVENT')
      } catch (e) {
        // Skip malformed booking
      }
    }

    lines.push('END:VCALENDAR')

    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="servigo-agenda.ics"`)
    res.status(200).send(lines.join('\r\n'))

  } catch (err) {
    console.error('icalFeed error:', err)
    res.status(500).send('Error generating calendar feed')
  }
})

// ── Auto Reminder (Cron) ──────────────────────────────────────────────────────

/**
 * Runs every hour. Finds bookings in the next 24h or 2h window
 * and sends Resend email reminders to client + provider.
 * Uses idempotency flags: reminderSent24h, reminderSent2h
 */
exports.autoReminder = functions.pubsub
  .schedule('every 60 minutes')
  .onRun(async () => {
    const db = admin.firestore()
    const now = Date.now()

    // Fetch all upcoming bookings that are active (not cancelled/completed)
    const snap = await db.collection('bookings')
      .where('status', 'in', ['confirmed', 'payment_held', 'in_progress'])
      .get()

    const bookings = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))

    for (const booking of bookings) {
      try {
        if (!booking.scheduledDate || !booking.scheduledTime) continue

        const [h, m] = (booking.scheduledTime || '09:00').split(':').map(Number)
        const bookingTime = new Date(`${booking.scheduledDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`).getTime()
        const diffMs = bookingTime - now
        const diffHours = diffMs / 3600000

        // Fetch provider schedule to check if reminders are enabled
        const schedSnap = await db.doc(`provider_schedules/${booking.providerId}`).get()
        const schedData = schedSnap.exists ? schedSnap.data() : {}
        const reminders = schedData.reminders || { enabled: false }
        if (!reminders.enabled) continue

        const timing = reminders.timing || ['24h']

        // 24h window: between 23h and 25h before
        if (timing.includes('24h') && diffHours >= 23 && diffHours <= 25 && !booking.reminderSent24h) {
          await sendBookingReminder(db, booking, '24h')
          await booking.ref.update({ reminderSent24h: true })
        }

        // 2h window: between 1.5h and 2.5h before
        if (timing.includes('2h') && diffHours >= 1.5 && diffHours <= 2.5 && !booking.reminderSent2h) {
          await sendBookingReminder(db, booking, '2h')
          await booking.ref.update({ reminderSent2h: true })
        }
      } catch (err) {
        console.error(`Reminder error for booking ${booking.id}:`, err)
      }
    }

    return null
  })

async function sendBookingReminder(db, booking, window) {
  // Get client + provider emails
  const [clientSnap, providerSnap] = await Promise.all([
    db.doc(`users/${booking.clientId}`).get(),
    db.doc(`users/${booking.providerId}`).get(),
  ])

  const clientEmail   = clientSnap.exists ? clientSnap.data().email : null
  const providerEmail = providerSnap.exists ? providerSnap.data().email : null
  const clientName    = booking.clientName || 'Cliente'
  const providerName  = booking.providerName || 'Proveedor'
  const serviceTitle  = booking.serviceTitle || 'Servicio'
  const price         = (booking.totalPrice || 0).toLocaleString('es-CL')

  const windowLabel = window === '24h' ? 'mañana' : 'en 2 horas'

  const resendApiKey = functions.config().resend?.api_key
  if (!resendApiKey) {
    console.warn('Resend API key not configured. Set with: firebase functions:config:set resend.api_key="re_..."')
    return
  }

  const sendEmail = async (to, subject, html) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ServiGo <no-reply@servigo.cl>',
        to: [to],
        subject,
        html,
      }),
    })
    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Resend error: ${err}`)
    }
  }

  const baseHtml = (title, body) => `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <div style="background:#6366F1;padding:16px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">ServiGo</h1>
      </div>
      <div style="background:white;border:1px solid #e4e4e7;border-top:none;padding:24px;border-radius:0 0 12px 12px">
        <h2 style="color:#18181B;margin-top:0">${title}</h2>
        ${body}
        <hr style="border:none;border-top:1px solid #f4f4f5;margin:24px 0">
        <p style="color:#71717A;font-size:12px">ServiGo — Marketplace de servicios en Chile</p>
      </div>
    </div>`

  // Email to client
  if (clientEmail) {
    await sendEmail(
      clientEmail,
      `Recordatorio: ${serviceTitle} ${windowLabel}`,
      baseHtml(
        `Tu servicio es ${windowLabel}`,
        `<p>Hola <strong>${clientName}</strong>,</p>
        <p>Este es un recordatorio de tu reserva:</p>
        <div style="background:#f4f4f5;padding:16px;border-radius:8px;margin:16px 0">
          <p style="margin:4px 0"><strong>Servicio:</strong> ${serviceTitle}</p>
          <p style="margin:4px 0"><strong>Proveedor:</strong> ${providerName}</p>
          <p style="margin:4px 0"><strong>Fecha:</strong> ${booking.scheduledDate}</p>
          <p style="margin:4px 0"><strong>Hora:</strong> ${booking.scheduledTime}</p>
          <p style="margin:4px 0"><strong>Total:</strong> $${price}</p>
        </div>
        <p>¿Tienes alguna consulta? Usa el chat en ServiGo para comunicarte con tu proveedor.</p>`
      )
    )
  }

  // Email to provider
  if (providerEmail) {
    await sendEmail(
      providerEmail,
      `Recordatorio: Tienes una reserva ${windowLabel}`,
      baseHtml(
        `Tienes una reserva ${windowLabel}`,
        `<p>Hola <strong>${providerName}</strong>,</p>
        <p>Este es un recordatorio de tu próxima reserva:</p>
        <div style="background:#f4f4f5;padding:16px;border-radius:8px;margin:16px 0">
          <p style="margin:4px 0"><strong>Servicio:</strong> ${serviceTitle}</p>
          <p style="margin:4px 0"><strong>Cliente:</strong> ${clientName}</p>
          <p style="margin:4px 0"><strong>Fecha:</strong> ${booking.scheduledDate}</p>
          <p style="margin:4px 0"><strong>Hora:</strong> ${booking.scheduledTime}</p>
          <p style="margin:4px 0"><strong>Total:</strong> $${price}</p>
        </div>
        <p>Ingresa a ServiGo para ver los detalles completos de la reserva.</p>`
      )
    )
  }

  console.log(`Reminder [${window}] sent for booking ${booking.id} to ${clientEmail}, ${providerEmail}`)
}
