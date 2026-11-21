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

## Two ways in

| Path | Link | Verified? |
|---|---|---|
| **Per-recipient** | `?t=<token>` | HMAC signature — prefills the address, cannot be forged |
| **Generic** | bare page, or `?email=…` | none — user types their address |

The **generic link** is the one to put in every email template, because a template cannot carry a
per-recipient token:

```
https://optout.techsambad.com/
```

The recipient types their address and presses the button. The per-recipient token still powers
faster one-click links for campaigns where you generate the list in advance.

**Trade-off, stated plainly:** the generic path cannot prove the person owns the address, so
anyone can add any address to the suppression list. Rows are therefore recorded with
`Source = unsubscribe-form` plus requester IP and user agent, so a griefing pattern is visible in
the sheet. If that ever becomes a real problem, the fix is a confirmation email before the
row is committed — the endpoint already holds a mail-capable credential.

## Generating links

```bash
python tools/make_optout_links.py --contacts colleges.csv --out links.csv
```

Contacts CSV needs an `email` column (override with `--column`). Output has `email` and
`optout_url`, deduplicated case-insensitively.

Put `{{optout_url}}` in the outreach template as the unsubscribe link.

## Deploying the endpoint — already done

The write path is a **Vercel serverless function**, deployed and live:

**https://techsambad-optout-api.vercel.app/api/optout**

Source: `vercel-api/api/optout.js`. Secrets live in the Vercel project's environment variables
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `OPTOUT_SECRET`,
`OPTOUT_SHEET_ID`, `SHEET_TAB`) — never in this repo.

Redeploy after a change:

```bash
cd vercel-api && vercel deploy --prod
```

`apps-script/Code.gs` is kept as a **fallback** in case you ever want to move off Vercel — same
token format, same sheet, deployable as a Google web app with no third-party account.

### Verified end to end

| Test | Result |
|---|---|
| Valid token POST | row appended with IST timestamp |
| Same token again | deduped, "already on our list" |
| Tampered signature | HTTP 400, nothing written |
| Health check `GET /api/optout` | `{"ok":true}` |

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
