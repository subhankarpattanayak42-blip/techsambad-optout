/**
 * TechSambad opt-out endpoint.
 *
 * Deployed as a Google Apps Script Web App, it is the only thing that writes to the
 * suppression sheet. The GitHub Pages form posts to it with a plain form POST, which is
 * why it works without CORS headaches.
 *
 * The signing secret lives in Script Properties, never in the public repo, so nobody can
 * forge an unsubscribe link for an address that is not theirs.
 *
 * SETUP (once, 3 minutes)
 *   1. script.google.com -> New project
 *   2. Project Settings -> Script properties, add:
 *        OPTOUT_SECRET   = <the value printed by tools/make_optout_links.py --secret>
 *        OPTOUT_SHEET_ID = <the suppression sheet id>
 *        SHEET_TAB       = Sheet1
 *   3. Paste this file in as Code.gs
 *   4. Deploy -> New deployment -> type "Web app"
 *        Execute as: Me
 *        Who has access: Anyone
 *   5. Copy the /exec URL into index.html (the ENDPOINT constant) and push.
 */

var SIG_LEN = 16;

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'techsambad-optout' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var token = (e && e.parameter && e.parameter.t) || '';
  var result = handleOptOut(token);
  return HtmlService.createHtmlOutput(page(result));
}

function handleOptOut(token) {
  var parts = String(token).split('.');
  if (parts.length !== 2) { return { status: 'invalid', email: '' }; }

  var email = '';
  try {
    email = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (err) {
    return { status: 'invalid', email: '' };
  }
  email = String(email).trim().toLowerCase();
  if (email.indexOf('@') < 1) { return { status: 'invalid', email: '' }; }

  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('OPTOUT_SECRET');
  var sheetId = props.getProperty('OPTOUT_SHEET_ID');
  var tab = props.getProperty('SHEET_TAB') || 'Sheet1';
  if (!secret || !sheetId) { return { status: 'error', email: email }; }

  var expected = hex(Utilities.computeHmacSha256Signature(email, secret)).slice(0, SIG_LEN);
  if (expected !== String(parts[1]).toLowerCase()) {
    return { status: 'invalid', email: '' };   // tampered or stale link
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName(tab) || ss.getActiveSheet();

  // idempotent: one row per address, ever
  var last = sh.getLastRow();
  if (last > 1) {
    var emails = sh.getRange(2, 2, last - 1, 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).trim().toLowerCase() === email) {
        return { status: 'already', email: email };
      }
    }
  }

  sh.appendRow([
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
    email,
    'email-unsubscribe',
    '',                                  // campaign: fill in later if you segment
    String(parts[1]).slice(0, 8),
    ''
  ]);

  return { status: 'ok', email: email };
}

function hex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function page(result) {
  var msg = result.status === 'already'
    ? 'You were already on our do-not-contact list. Nothing further will be sent.'
    : result.status === 'ok'
      ? 'You have been removed. We will not write to you again.'
      : 'This link could not be verified. Reply to the email with the word unsubscribe.';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>TechSambad</title></head>'
    + '<body style="font-family:Arial,sans-serif;padding:24px">' + msg + '</body></html>';
}
