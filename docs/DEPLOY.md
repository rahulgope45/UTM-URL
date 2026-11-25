# Deployment plan: AWS, short-term, no domain

**Status:** plan, not yet implemented.

**Goal:** run the app (and optionally Kutt) on AWS for a few days or weeks, paid from free credits, reachable over **HTTPS** without buying a domain, and easy to tear down completely.

## Why HTTPS even for a short demo
- `navigator.clipboard` (the **Copy** buttons in the link builder) only works on HTTPS or localhost.
- A real website on `https://` can't send tracking events to an `http://` tracker. Browsers block that as mixed content.
- The dashboard needs a password, and that password must not travel in plain text.

## The no-domain trick: sslip.io
[sslip.io](https://sslip.io) is a free public DNS service: `13-233-10-20.sslip.io` resolves to `13.233.10.20`, and so does any prefix (`go.13-233-10-20.sslip.io`). That's a real hostname, so **Caddy** can get a free Let's Encrypt certificate for it automatically.

The limits: it depends on a third-party DNS service, and the URL looks odd. Both are fine for a demo, not for production.

## Recommended architecture
```
                    Internet (HTTPS)
                          │
     ┌────────────────────▼─────────────────────────────┐
     │ EC2 t3.small · Ubuntu 24.04 · Elastic IP         │
     │ Security group: 80, 443 open; SSH only via SSM   │
     │                                                  │
     │  ┌──────────── Caddy (TLS + basic auth) ───────┐ │
     │  │ app.<ip>.sslip.io  ─►  utm-app:3000         │ │
     │  │ go.<ip>.sslip.io   ─►  kutt:3000 (optional) │ │
     │  └─────────────────────────────────────────────┘ │
     │  Docker Compose · data on EBS volume (SQLite)    │
     └──────────────────────────────────────────────────┘
```

**Caddy password rules:**
- **Password protected:** `/dashboard/*`, `/builder/*`, `/api/report`, `/api/spend`, `/api/links`. This covers the app's "no login" gap without any code change.
- **Public:** `/tracker.js`, `/api/collect/*`, `/store/*`, `/api/demo/*`. Visitors' browsers must reach these.

### Why EC2 and not the other options
| Option | Verdict |
|---|---|
| **EC2 + Docker Compose + Caddy** | ✅ Chosen. SQLite needs a persistent disk, everything fits on one small box, it's cheap, and teardown is one action. |
| App Runner / Fargate | ❌ The container filesystem is temporary, so SQLite data is lost on every restart or redeploy. We'd need RDS, which adds cost and changes the code. |
| Fargate + ALB | ❌ The load balancer alone costs about $16+/month, which is overkill. |
| Lightsail | ⚖️ Also works (fixed price, simpler console), but it uses Lightsail's own billing and may not draw on your AWS credits the same way. Check first. |

## Phase 1: add to the repo (before touching AWS)
- [ ] `Dockerfile`: `node:24-slim`, `npm ci --omit=dev`, runs as a non-root user, `HEALTHCHECK`, `DB_FILE=/data/utm.db`.
- [ ] `.dockerignore`: excludes `node_modules`, `data`, `.env`, `.git`.
- [ ] `GET /api/health` → `{ok:true}`, for health checks.
- [ ] `deploy/docker-compose.yml`: `app`, `caddy` and an optional `kutt` (profile `kutt`), with named volumes `app-data`, `caddy-data` and `kutt-data`, and `restart: unless-stopped`.
- [ ] `deploy/Caddyfile`: two sites from env (`{$APP_HOST}`, `{$KUTT_HOST}`), basic auth on the admin paths, security headers.
- [ ] `deploy/.env.production.example`: `APP_HOST`, `KUTT_HOST`, `ADMIN_USER`, `ADMIN_PASSWORD_HASH`, `CONVERSION_SECRET`, `ALLOWED_ORIGINS`, `DEMO_STORE`, `KUTT_API_KEY`.
- [ ] `deploy/bootstrap.sh`: installs Docker on Ubuntu, clones the repo, runs `docker compose up -d`.
- [ ] Test locally with `docker compose up` before deploying.

## Phase 2: AWS setup (console, about 20 minutes)
1. **Budget alarm first.** Billing → Budgets: create a $10/month budget with an email alert at 50%.
2. **Region:** `ap-south-1` (Mumbai) for low latency in India.
3. **IAM role for the instance:** attach the `AmazonSSMManagedInstanceCore` policy, so we connect with **Session Manager** and don't need SSH keys or port 22.
4. **Security group:** allow inbound TCP **80** and **443** from `0.0.0.0/0`. Nothing else.
5. **Launch EC2:**
   - Instance: Ubuntu 24.04 LTS (x86_64), **t3.small** (2 GB RAM; app + Kutt + Caddy fit comfortably).
   - Storage: 20 GB gp3.
   - Metadata: IMDSv2 required.
   - Attach the role and the security group from steps 3 and 4.
6. **Elastic IP:** allocate one and associate it with the instance. The IP, and so the sslip.io hostname, then stays the same across stop and start.
7. **Connect** with Session Manager, then run `bootstrap.sh`.
8. **Configure** `deploy/.env.production`:
   - `APP_HOST=app.<ip-with-dashes>.sslip.io`
   - generate a strong admin password and the conversion secret
   - `DEMO_STORE=true` for the demo
9. **Start:** `docker compose up -d`. Caddy fetches certificates automatically within about a minute.
10. **Kutt (optional):**
    - Open `https://go.<ip>.sslip.io`, create the admin account and generate an API key.
    - Put the key in `.env.production` as `KUTT_API_KEY`, with `KUTT_URL=http://kutt:3000` (internal) and `DEFAULT_DOMAIN=go.<ip>.sslip.io`.
    - Run `docker compose up -d` again.

## Phase 3: verify
- [ ] `https://app.<ip>.sslip.io/api/health` → `{"ok":true}` with a valid padlock.
- [ ] `/dashboard/` asks for the password. `/store/` doesn't.
- [ ] Open a campaign link on your phone (mobile data, not Wi-Fi), buy something, and the dashboard shows it.
- [ ] Builder → shorten → the short link redirects and is counted.
- [ ] `docker compose restart` → the data is still there.
- [ ] Back up: `docker compose cp app:/data/utm.db ./backup.db`, or snapshot the EBS volume.

## Cost estimate (paid from credits)
| Item | Approx. per month |
|---|---|
| EC2 t3.small (on-demand, Mumbai) | ~$15 |
| EBS 20 GB gp3 | ~$2 |
| Public IPv4 / Elastic IP ($0.005/h) | ~$3.6 |
| Data transfer (demo traffic) | ~$0 |
| **Total** | **~$20/month ≈ $0.70/day** |

A one-week demo costs about $5 of credits. Use a `t3.micro` (1 GB) to halve that if you skip Kutt.

> Note: depending on your account's plan, some instance types may be free-tier eligible. Check the "Free tier eligible" label when launching.

## Teardown (when you're done)
1. Back up `utm.db` if you want to keep the data.
2. **Terminate** the EC2 instance (its EBS volume is deleted with it).
3. **Release the Elastic IP.** An unattached EIP still costs money.
4. Delete the security group, the IAM role and any EBS snapshots.
5. Check the Billing → Bills page the next day: it should show $0/day.

## Risks / limits of this setup
- **Single instance:** no high availability. If it dies, restore from backup. Acceptable for a demo.
- **sslip.io:** a third-party DNS service. If it's down, the site is unreachable. Move to a real domain with a Route 53 hosted zone (~$0.50/month plus the domain) for anything long-lived.
- **Let's Encrypt rate limits:** sslip.io's shared domain is popular, so certificate issuance can occasionally hit limits. Retry later, or use the ZeroSSL fallback (Caddy does this automatically).
- **Basic auth** is a single shared password, fine for a demo. Real users need proper login.
