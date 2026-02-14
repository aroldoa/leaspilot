import twilio from 'twilio';

let client = null;

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  if (!client) client = twilio(accountSid, authToken);
  return client;
}

/**
 * Send an SMS via Twilio. Returns { success: true, sid } or { success: false, error }.
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in env.
 * @param {string} to - E.164 phone number (e.g. +15551234567)
 * @param {string} body - Message text
 */
export async function sendSms(to, body) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from || !from.trim()) {
    return { success: false, error: 'TWILIO_PHONE_NUMBER is not set. Add a Twilio phone number in .env' };
  }
  const c = getClient();
  if (!c) {
    return { success: false, error: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env' };
  }
  const raw = String(to).trim();
  const normalized = raw.replace(/\D/g, '');
  let toE164 = raw;
  if (normalized.length === 10) {
    toE164 = '+1' + normalized;
  } else if (normalized.length === 11 && normalized[0] === '1') {
    toE164 = '+' + normalized;
  } else if (normalized.length === 11 && normalized[0] !== '1') {
    // 11 digits without leading 1: assume US number (e.g. 21086501234 → +12108650123)
    toE164 = '+1' + normalized.slice(0, 10);
  } else if (normalized.length >= 10 && normalized.length <= 15 && !raw.startsWith('+')) {
    toE164 = '+' + normalized;
  } else if (!raw.startsWith('+')) {
    toE164 = '+' + raw;
  }
  try {
    const message = await c.messages.create({
      body: String(body).slice(0, 1600),
      from: from.trim(),
      to: toE164
    });
    return { success: true, sid: message.sid };
  } catch (err) {
    console.error('Twilio SMS error:', err);
    let msg = err.message || err.code || 'Failed to send SMS';
    if (typeof msg === 'string' && (msg.includes('unverified') || msg.includes('verified') || msg.includes('Trial'))) {
      msg = 'Twilio trial accounts can only text verified numbers. Verify this number at twilio.com/user/account/phone-numbers/verified or upgrade your Twilio account to text any number.';
    }
    return { success: false, error: msg };
  }
}

export function isTwilioConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER?.trim());
}
