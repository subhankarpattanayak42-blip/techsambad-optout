// TechSambad opt-out endpoint (Vercel serverless).
//
// Verifies a signed token, then appends the address to the suppression sheet.
// Server-side only: the HMAC secret and the Google refresh token live in Vercel env vars,
// never in the public GitHub Pages repo.
//
// Env vars required:
//   OPTOUT_SECRET        signing key shared with tools/make_optout_links.py
//   OPTOUT_SHEET_ID      suppression spreadsheet id
//   SHEET_TAB            tab name (default Sheet1)
//   GOOGLE_CLIENT_ID     OAuth client
//   GOOGLE_CLIENT_SECRET OAuth client secret
//   GOOGLE_REFRESH_TOKEN refresh token with Sheets scope

import crypto from 'node:crypto';

const SIG_LEN = 16;

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

function parseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  let email;
  try {
    email = b64urlDecode(parts[0]).trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email.includes('@') || email.length > 254) return null;
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
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

async function alreadyListed(at, sheetId, tab, email) {
  const range = encodeURIComponent(`${tab}!B2:B`);
  const r = await fetch(`${SHEETS}/${sheetId}/values/${range}?majorDimension=COLUMNS`, {
    headers: { Authorization: `Bearer ${at}` },
  });
  if (!r.ok) return false;
  const values = await r.json();
  const col = (values.values && values.values[0]) || [];
  return col.some((v) => String(v).trim().toLowerCase() === email);
}

async function appendRow(at, sheetId, tab, row) {
  const range = encodeURIComponent(`${tab}!A:F`);
  const r = await fetch(
    `${SHEETS}/${sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    },
  );
  if (!r.ok) throw new Error(`append ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function istStamp() {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().replace('T', ' ').slice(0, 19);
}

function html(status, message, ok) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TechSambad</title></head>
<body style="font-family:Arial,sans-serif;padding:24px">${message}</body></html>`;
}

export default async function handler(req, res) {
  const token = (req.body && req.body.t) || (req.query && req.query.t) || '';
  const parsed = parseToken(token);

  const secret = process.env.OPTOUT_SECRET;
  const sheetId = process.env.OPTOUT_SHEET_ID;
  const tab = process.env.SHEET_TAB || 'Sheet1';

  if (!secret || !sheetId) {
    res.status(500).send(html('error', 'Endpoint not configured.', false));
    return;
  }

  if (!parsed || !timingSafeEq(sign(parsed.email, secret), parsed.sig)) {
    if (req.method === 'GET' && !token) {
      res.status(200).json({ ok: true, service: 'techsambad-optout' });
      return;
    }
    res.status(400).send(html('invalid', 'This link could not be verified.', false));
    return;
  }

  try {
    const at = await accessToken();

    if (await alreadyListed(at, sheetId, tab, parsed.email)) {
      res.status(200).send(html('already', 'You were already on our do-not-contact list.', true));
      return;
    }

    await appendRow(at, sheetId, tab, [
      istStamp(),
      parsed.email,
      'email-unsubscribe',
      '',
      parsed.sig.slice(0, 8),
      '',
    ]);

    res.status(200).send(html('ok', 'You have been removed. We will not write to you again.', true));
  } catch (e) {
    console.error('optout failure:', e.message);
    res.status(500).send(html('error', 'That did not go through.', false));
  }
}
