#!/usr/bin/env python3
"""Finish the optout.techsambad.com cutover the moment DNS resolves.

Runs from cron. Silent no-op until the CNAME record exists, then:
  1. points GitHub Pages at the custom domain
  2. commits the CNAME file so a rebuild cannot revert it
  3. waits for the HTTPS certificate to be issued
  4. emails Subhankar with the result

A sentinel file means it does the work exactly once and then stays quiet forever.
"""
import os
import subprocess
import sys
import time

REPO = os.path.expanduser('~/techsambad-optout')
DOMAIN = 'optout.techsambad.com'
TARGET = 'subhankarpattanayak42-blip.github.io'
SENTINEL = os.path.join(REPO, '.domain-done')
GH_REPO = 'subhankarpattanayak42-blip/techsambad-optout'


def sh(cmd, cwd=REPO, check=False):
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError('%s -> %s %s' % (cmd, r.returncode, r.stderr[:300]))
    return r.stdout.strip()


def dns_ready():
    out = sh('dig +short CNAME %s' % DOMAIN).strip().rstrip('.').lower()
    return TARGET in out


def main():
    if os.path.exists(SENTINEL):
        return 0                                  # already done, stay silent
    if not dns_ready():
        return 0                                  # not yet, stay silent

    steps = []
    try:
        sh('gh api -X PUT repos/%s/pages -f cname=%s' % (GH_REPO, DOMAIN), check=True)
        steps.append('pages custom domain set')
    except Exception as e:
        print('FAILED to set custom domain:', e)
        return 1

    if not os.path.exists(os.path.join(REPO, 'CNAME')):
        open(os.path.join(REPO, 'CNAME'), 'w').write(DOMAIN + '\n')
        sh('git add CNAME && git -c user.email=subu@techsambad.com '
           '-c user.name="Subhankar Pattanayak" commit -m "Custom domain: %s"' % DOMAIN, check=True)
        sh('git push origin main', check=True)
        steps.append('CNAME committed and pushed')

    cert = ''
    for _ in range(10):                           # ~5 minutes
        time.sleep(30)
        cert = sh('gh api repos/%s/pages --jq .https_certificate.state' % GH_REPO).strip()
        if cert == 'approved':
            break

    code = sh('curl -s -o /dev/null -w "%%{http_code}" https://%s/ --max-time 20' % DOMAIN).strip()
    open(SENTINEL, 'w').write('%s cert=%s http=%s\n' % (time.strftime('%Y-%m-%d %H:%M'),
                                                        cert, code))

    body = ('optout.techsambad.com is live.\n\n'
            'Steps: %s\n'
            'HTTPS certificate: %s\n'
            'Live check: HTTP %s\n\n'
            'Regenerate links against the branded domain:\n'
            '  python3 tools/make_optout_links.py --contacts colleges.csv '
            '--base https://%s/ --out links.csv\n' % (', '.join(steps), cert or 'unknown', code, DOMAIN))
    print(body)
    try:
        sys.path.insert(0, os.path.expanduser(
            '~/.hermes/profiles/intern-manager/workspace/interns'))
        import mail_html as mh
        mh.send('subu@techsambad.com', 'optout.techsambad.com is live',
                [mh.p('The custom domain resolved and the GitHub Pages cutover is done.'),
                 mh.p('Cert: <strong>%s</strong> · live check HTTP <strong>%s</strong>'
                      % (cert or 'unknown', code)),
                 mh.button('Open the page', 'https://%s/' % DOMAIN),
                 mh.p('Regenerate the outreach links against the branded domain:<br/>'
                      '<code>python3 tools/make_optout_links.py --contacts colleges.csv '
                      '--base https://%s/ --out links.csv</code>' % DOMAIN)],
                body, kicker='Opt-out')
        print('emailed subu@techsambad.com')
    except Exception as e:
        print('email failed (result still printed above):', e)
    return 0


if __name__ == '__main__':
    sys.exit(main())
