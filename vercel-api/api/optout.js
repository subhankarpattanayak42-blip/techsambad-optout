// TechSambad opt-out endpoint (Vercel serverless).
//
// Two ways in:
//   t=<signed token>   one-click link generated per recipient
//   email=<address>    the generic link embedded in every email; the user types their address
//
// A signed token is verified with HMAC and cannot be forged for someone else's address.
// The generic path cannot be verified, so it is recorded with its source and requester IP for
// audit. Nothing is ever sent to the address - this only writes to the suppression list.
//
// Env vars: OPTOUT_SECRET, OPTOUT_SHEET_ID, SHEET_TAB, GOOGLE_CLIENT_ID,
//           GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

import crypto from 'node:crypto';

const SIG_LEN = 16;
const ALLOWED_ORIGINS = [
  'https://subhankarpattanayak42-blip.github.io',
  'https://optout.techsambad.com',
];

function cors(req) {
  const origin = req.headers.origin || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function b64urlDecode(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

function sign(email, secret) {
  return crypto.createHmac('sha256', secret).update(email).digest('hex').slice(0, SIG_LEN);
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return null;
  if (!EMAIL_RE.test(e)) return null;
  return e;
}

function parseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  let email;
  try {
    email = cleanEmail(b64urlDecode(parts[0]));
  } catch {
    return null;
  }
  if (!email) return null;
  return { email, sig: parts[1].toLowerCase() };
}

async function accessToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error('token exchange ' + r.status);
  return (await r.json()).access_token;
}

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

async function alreadyListed(at, sheetId, tab, email) {
  const range = encodeURIComponent(tab + '!B2:B');
  const r = await fetch(SHEETS + '/' + sheetId + '/values/' + range + '?majorDimension=COLUMNS', {
    headers: { Authorization: 'Bearer ' + at },
  });
  if (!r.ok) return false;
  const values = await r.json();
  const col = (values.values && values.values[0]) || [];
  return col.some((v) => String(v).trim().toLowerCase() === email);
}

async function appendRow(at, sheetId, tab, row) {
  const range = encodeURIComponent(tab + '!A:F');
  const url = SHEETS + '/' + sheetId + '/values/' + range +
    ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  if (!r.ok) throw new Error('append ' + r.status);
  return r.json();
}

function istStamp() {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().replace('T', ' ').slice(0, 19);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return String(fwd).split(',')[0].trim() || 'unknown';
}

export default async function handler(req, res) {
  Object.entries(cors(req)).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const token = body.t || (req.query && req.query.t) || '';
  const typed = body.email || (req.query && req.query.email) || '';

  const secret = process.env.OPTOUT_SECRET;
  const sheetId = process.env.OPTOUT_SHEET_ID;
  const tab = process.env.SHEET_TAB || 'Sheet1';

  if (!secret || !sheetId) {
    res.status(500).json({ ok: false, status: 'error', message: 'Endpoint not configured.' });
    return;
  }

  let email = null;
  let source = null;
  let tokenSig = '';

  if (token) {
    const parsed = parseToken(token);
    if (!parsed || !timingSafeEq(sign(parsed.email, secret), parsed.sig)) {
      res.status(400).json({ ok: false, status: 'invalid', message: 'This link could not be verified.' });
      return;
    }
    email = parsed.email;
    source = 'email-unsubscribe-link';
    tokenSig = parsed.sig;
  } else if (typed) {
    email = cleanEmail(typed);
    if (!email) {
      res.status(400).json({
        ok: false, status: 'bad-email',
        message: 'That does not look like an email address.',
      });
      return;
    }
    source = 'unsubscribe-form';
  } else if (req.method === 'GET') {
    res.status(200).json({ ok: true, service: 'techsambad-optout' });
    return;
  } else {
    res.status(400).json({ ok: false, status: 'no-input', message: 'No address supplied.' });
    return;
  }

  try {
    const at = await accessToken();

    if (await alreadyListed(at, sheetId, tab, email)) {
      res.status(200).json({
        ok: true, status: 'already', email,
        message: 'That address was already on our do-not-contact list.',
      });
      return;
    }

    await appendRow(at, sheetId, tab, [
      istStamp(),
      email,
      source,
      '',
      tokenSig.slice(0, 8),
      'ip=' + clientIp(req) + ' ua=' + String(req.headers['user-agent'] || '').slice(0, 60),
    ]);

    res.status(200).json({
      ok: true, status: 'ok', email,
      message: 'You have been removed. We will not write to you again.',
    });
  } catch (e) {
    console.error('optout failure:', e.message);
    res.status(500).json({
      ok: false, status: 'error',
      message: 'That did not go through. Please try again.',
    });
  }
}
