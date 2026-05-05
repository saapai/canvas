// Bruin Meals dispatcher — forwards iMessages to the bruin-meals app for
// users whose active service is "meals", or anyone texting `MEALS <code>`
// to claim an invite.
//
// Lives in canvas (which owns the SendBlue webhook URL). The decision is
// driven by a shared Postgres table, `bm_user_services`, that bruin-meals
// writes to during invite-code redemption. If the bm_ tables don't exist
// yet (e.g. the new app hasn't run migrations), this module silently
// no-ops and canvas's normal routing handles the message.
//
// Required env (both must be set, otherwise dispatcher no-ops):
//   BRUIN_MEALS_INBOUND_URL       e.g. https://bruin-meals.vercel.app/api/sendblue/inbound
//   BRUIN_MEALS_DISPATCH_SECRET   matches CANVAS_DISPATCH_SECRET in bruin-meals env

import crypto from 'crypto';
import { getPool } from './db.js';

const UNLOCK_RE = /^\s*(?:unlock\s+)?meals\s+[A-Za-z0-9-]{4,32}\b/i;
const FORWARD_TIMEOUT_MS = 8000;

function normalizePhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

async function isMealsUser(phoneNormalized) {
  try {
    const db = getPool();
    const r = await db.query(
      `SELECT 1 FROM bm_user_services
        WHERE phone_normalized = $1
          AND service = 'meals'
          AND status = 'active'
        LIMIT 1`,
      [phoneNormalized]
    );
    return r.rows.length > 0;
  } catch (err) {
    // Most likely cause: bm_user_services doesn't exist yet (bruin-meals
    // hasn't run its first migration). Treat as "not a meals user" so
    // canvas's normal routing handles the message.
    if (err && err.code !== '42P01') {
      console.warn('[bm-dispatch] user_services lookup failed:', err.message);
    }
    return false;
  }
}

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Decide whether this inbound message should go to bruin-meals, and if so
 * forward it. Returns:
 *   - { handled: true }  → caller should return early and not run canvas's
 *                          normal SendBlue routing.
 *   - { handled: false } → caller should proceed with canvas's existing logic.
 *
 * Guarantees the call returns within FORWARD_TIMEOUT_MS + a small overhead.
 * Never throws.
 */
export async function maybeDispatchToBruinMeals(req) {
  const url = process.env.BRUIN_MEALS_INBOUND_URL;
  const secret = process.env.BRUIN_MEALS_DISPATCH_SECRET;
  if (!url || !secret) return { handled: false };

  try {
    const body = req?.body ?? {};
    if (body.is_outbound) return { handled: false };

    const phoneNormalized = normalizePhone(body.from_number || body.number);
    if (!phoneNormalized) return { handled: false };

    // All inbound messages route exclusively to bruin-meals.
    // Canvas texting and sep-ats are disabled.

    const fwdBody = JSON.stringify({
      content: body.content,
      number: body.number,
      from_number: body.from_number,
      is_outbound: body.is_outbound,
      message_handle: body.message_handle,
      media_url: body.media_url,
    });
    const sig = sign(secret, fwdBody);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bm-signature': sig,
        },
        body: fwdBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      console.warn(`[bm-dispatch] non-2xx ${resp.status} for ${phoneNormalized}`);
      // Still mark as handled — canvas texting is disabled, only bruin-meals responds.
      return { handled: true };
    }

    return { handled: true };
  } catch (err) {
    console.warn('[bm-dispatch] forward failed:', err && err.message);
    // Canvas texting disabled — nothing to fall through to.
    return { handled: true };
  }
}
