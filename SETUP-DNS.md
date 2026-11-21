# Pointing optout.techsambad.com at the page

One DNS record. **GoDaddy** holds the zone (`ns37/ns38.domaincontrol.com`).

## The record

| Type | Name | Value | TTL |
|---|---|---|---|
| CNAME | `optout` | `subhankarpattanayak42-blip.github.io` | 1 hour (default) |

No `@`, no trailing dot, no `https://` in the value. Just the hostname above.

GoDaddy: **My Products → techsambad.com → DNS → Add New Record**
→ Type `CNAME`, Name `optout`, Value `subhankarpattanayak42-blip.github.io`, TTL 1 Hour → Save.

## Order of operations matters

The `CNAME` file is deliberately **not** in this repo yet. Committing it before the DNS
record exists makes GitHub serve the custom domain immediately — and since nothing resolves
there yet, the working `github.io` URL breaks in the meantime.

So: **DNS first, then the CNAME file.** Once `dig +short CNAME optout.techsambad.com`
returns the github.io hostname:

```bash
# 1. tell GitHub the custom domain
gh api -X PUT repos/subhankarpattanayak42-blip/techsambad-optout/pages \
  -f cname=optout.techsambad.com

# 2. commit the CNAME file so the setting survives a rebuild
printf 'optout.techsambad.com\n' > CNAME
git add CNAME && git commit -m "Custom domain" && git push

# 3. verify
dig +short optout.techsambad.com
curl -sI https://optout.techsambad.com/ | head -3
gh api repos/subhankarpattanayak42-blip/techsambad-optout/pages --jq '.cname,.https_certificate.state'
```

The certificate provision takes a few minutes after DNS resolves. Until
`https_certificate.state` is `approved`, HTTPS on the custom domain shows a warning —
the github.io URL keeps working throughout, so send nothing until the cert is green.

## After it is green

The unsubscribe link in outreach email becomes:

```
https://optout.techsambad.com/?t=<token>
```

Regenerate links with `--base https://optout.techsambad.com/` so the footer carries the
branded domain rather than a github.io address:

```bash
python3 tools/make_optout_links.py --contacts colleges.csv --base https://optout.techsambad.com/ --out links.csv
```

The token does not change — only the surrounding URL — so links already generated stay
valid if the path stays `/`.
