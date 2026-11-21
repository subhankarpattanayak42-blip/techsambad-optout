# TechSambad opt-out

A one-click unsubscribe link for TechSambad outreach email. Static page on GitHub Pages,
write path through a Google Apps Script web app into a Google Sheet in Drive.

**Live page:** https://subhankarpattanayak42-blip.github.io/techsambad-optout/

## Why it is split in two

GitHub Pages is static — it cannot write to a Google Sheet. A browser cannot either without
OAuth. So:

```
email link  →  GitHub Pages page  →  form POST  →  Apps Script web app  →  Google Sheet
               (public, no secret)                 (secret lives here)     (suppression list)
```

No secret is in this repo. Anyone can read the page; only a correctly signed token can
record an opt-out, because the HMAC secret exists only in Apps Script properties.

## Token format

```
t = base64url(lowercased email) "." first 16 hex chars of HMAC-SHA256(email, secret)
```

The page decodes the email only to show it back, masked. It never decides anything —
the Apps Script endpoint recomputes the signature and rejects a token that does not match.
So a crafted link cannot unsubscribe someone else.

## Generating links

```bash
python tools/make_optout_links.py --contacts colleges.csv --out links.csv
```

Contacts CSV needs an `email` column (override with `--column`). Output has `email` and
`optout_url`, deduplicated case-insensitively.

Put `{{optout_url}}` in the outreach template as the unsubscribe link.

## Deploying the endpoint (once)

1. Open [script.google.com](https://script.google.com) → **New project**.
2. **Project Settings → Script properties**, add three:

   | Property | Value |
   |---|---|
   | `OPTOUT_SECRET` | the secret from `tools/make_optout_links.py --secret` |
   | `OPTOUT_SHEET_ID` | `1EmMw8HOuNp1H7yYlg1H__vwAsOZq_2IWWFvSYTQ7Mss` |
   | `SHEET_TAB` | `Sheet1` |

3. Paste `apps-script/Code.gs` in as the project's `Code.gs`.
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the `/exec` URL, replace `__ENDPOINT__` in `index.html`, commit and push.

## The suppression sheet

**TechSambad Opt-Outs** — in the TechSambad Marketing Drive folder.

| Timestamp (IST) | Email | Source | Campaign | Link token (first 8) | Note |
|---|---|---|---|---|---|

Append-only, one row per address, deduplicated by the endpoint. **Check it before every
campaign send** — an address in this sheet must never be emailed again, in any campaign,
from any tool.

## Rotating the secret

If the secret leaks: change `OPTOUT_SECRET` in Apps Script properties, then regenerate all
links. Existing links in already-sent email stop working — which is why a leaked secret is
a real incident, not a minor one.

## Notes for whoever maintains this

- The page requires a **click to confirm**; nothing happens on load. That matters — mail
  scanners follow links automatically, and an unsubscribe that fires on GET would silently
  remove people who never clicked.
- The form posts into a hidden iframe because Apps Script does not send CORS headers; a
  plain form POST always lands where `fetch` can be blocked.
- The invalid-token page tells the reader to reply with "unsubscribe", so a broken link
  never traps someone who wants out.
