/**
 * Transactional-email transport.
 *
 * Stub: logs the payload. A future slice will replace this with a real
 * provider (Postmark / SES / SendGrid). Callers depend only on the
 * `sendMail()` surface; swapping the transport does not require touching
 * the auth actions.
 */

export interface OutgoingMail {
  to:      string
  subject: string
  text:    string
  html?:   string
  /** Optional tag for observability once we have a real transport. */
  category?:
    | 'password-reset'
    | 'email-verification'
    | 'mfa-enrollment'
    | 'portal-invite'
    | 'portal-reminder'
    | 'portal-clarification'
    | 'portal-receipt'
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  // Do not log the token itself in production once a real transport exists.
  // For now, in dev, the log IS the delivery channel.
  console.info('[mail]', JSON.stringify({
    to:       mail.to,
    subject:  mail.subject,
    category: mail.category,
    preview:  mail.text.slice(0, 200),
  }))
}
