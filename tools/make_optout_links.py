#!/usr/bin/env python3
"""Generate signed opt-out links for a TechSambad college outreach campaign.

    python make_optout_links.py --contacts contacts.csv --out links.csv
    python make_optout_links.py --secret            # print the secret to paste into Apps Script

The token is  base64url(email) + "." + first 16 hex of HMAC-SHA256(email_lower, secret).
The same secret is set in the Apps Script properties, so the endpoint can verify a token
without ever trusting the browser.

Secret source, in order of precedence:
  1. --secret-stdin / $OPTOUT_SECRET
  2. ~/.hermes/profiles/intern-manager/.env.optout   (created earlier, chmod 600)

Never commit the secret. If it leaks, rotate it in Apps Script and regenerate the links.
"""
import argparse
import base64
import csv
import hashlib
import hmac
import os
import sys

PAGES_BASE = 'https://subhankarpattanayak42-blip.github.io/techsambad-optout/'
ENV_FILE = os.path.expanduser('~/.hermes/profiles/intern-manager/.env.optout')


def load_secret(explicit=None):
    if explicit:
        return explicit.strip()
    if os.environ.get('OPTOUT_SECRET'):
        return os.environ['OPTOUT_SECRET'].strip()
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE):
            if line.startswith('OPTOUT_SECRET='):
                return line.split('=', 1)[1].strip()
    sys.exit('No secret found. Pass --secret, set OPTOUT_SECRET, or create %s' % ENV_FILE)


def token_for(email, secret):
    e = email.strip().lower()
    b64 = base64.urlsafe_b64encode(e.encode('utf-8')).decode('ascii').rstrip('=')
    sig = hmac.new(secret.encode('utf-8'), e.encode('utf-8'), hashlib.sha256).hexdigest()[:16]
    return '%s.%s' % (b64, sig)


def link_for(email, secret, base=PAGES_BASE):
    return '%s?t=%s' % (base, token_for(email, secret))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--contacts', help='CSV with an email column')
    ap.add_argument('--column', default='email')
    ap.add_argument('--out', default='links.csv')
    ap.add_argument('--base', default=PAGES_BASE)
    ap.add_argument('--secret', action='store_true', help='print the local secret and exit')
    a = ap.parse_args()

    if a.secret:
        print(load_secret())
        return

    if not a.contacts:
        ap.error('--contacts is required unless --secret is passed')

    secret = load_secret()
    rows = list(csv.DictReader(open(a.contacts, encoding='utf-8-sig')))
    if not rows:
        sys.exit('no rows in %s' % a.contacts)
    if a.column not in rows[0]:
        sys.exit('column %r not found; columns are %s' % (a.column, list(rows[0].keys())))

    out = []
    seen = set()
    for r in rows:
        e = (r.get(a.column) or '').strip()
        if '@' not in e:
            continue
        k = e.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append({'email': e, 'optout_url': link_for(e, secret, a.base)})

    with open(a.out, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=['email', 'optout_url'])
        w.writeheader()
        w.writerows(out)

    print('wrote %d links to %s' % (len(out), a.out))
    print('first:', out[0]['optout_url'][:110] + '…')


if __name__ == '__main__':
    main()
