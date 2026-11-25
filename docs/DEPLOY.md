# Deployment plan: AWS, short-term, no domain

**Status:** Phase 1 done and tested locally (HTTPS, password rules, Kutt shortening, data persists across restarts). Phase 2 is next.

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

## Phase 1: repo changes ✅ done
| File | What it does |
|---|---|
| `Dockerfile` | `node:24-slim`, `npm ci --omit=dev`, non-root user, `HEALTHCHECK` on `/api/health`, data in `/data` |
| `.dockerignore` | Keeps `node_modules`, data, secrets, docs and tests out of the image |
| `deploy/docker-compose.yml` | `app` + `caddy` + `kutt` (profile `kutt`), named volumes, `restart: unless-stopped` |
| `deploy/Caddyfile` | HTTPS for `APP_HOST` and `KUTT_HOST`, basic auth on admin paths, security headers |
| `deploy/setup.sh` | One-time interactive setup: detects the public IP (IMDSv2), builds the sslip.io hostnames, generates secrets, hashes the admin password, writes `deploy/.env` and `deploy/auth.caddy` (mode 600) |
| `deploy/bootstrap.sh` | Installs Docker, adds swap on small instances, runs `setup.sh` the first time, builds and starts, waits for health, loads demo data if chosen. Safe to re-run; it's also the update command. |
| `src/app.js` | `GET /api/health`; `GET /api/links` now includes visits, orders and revenue per link |

Test the stack locally: `cd deploy && ./setup.sh --local && docker compose up -d --build`, then open `https://localhost` and accept the local certificate. Tear down with `docker compose down -v && rm .env auth.caddy`.

## Phase 2: AWS setup (you, in the console)
1. **Budget alarm:** Billing → Budgets → $10/month, email alert at 50%.
2. **Region:** `ap-south-1` (Mumbai).
3. **Launch the instance** (EC2 → Launch instance):
   - Name: `utm-demo`
   - AMI: **Ubuntu Server 24.04 LTS (x86_64)**
   - Type: **t3.small** (2 GB). Use `t3.micro` only if you skip Kutt; the script adds swap.
   - Key pair: create one (`.pem`), or skip it if you'll use EC2 Instance Connect.
   - Network → security group:
     - SSH 22 from **My IP**
     - HTTP 80 and HTTPS 443 from **Anywhere**
   - Storage: 20 GB gp3
   - Advanced → Metadata version: **V2 only**
4. **Elastic IP:** EC2 → Elastic IPs → Allocate → Associate with `utm-demo`. Do this **before** step 6, because the URLs are built from this IP.
5. **Connect:** EC2 → instance → **Connect** → *EC2 Instance Connect* (browser), or `ssh -i key.pem ubuntu@<elastic-ip>`.
6. **Install:**
   ```bash
   git clone https://github.com/rahulgope45/UTM-URL.git && cd UTM-URL
   sudo ./deploy/bootstrap.sh
   ```
   Answer the questions (username, password, Kutt Y/n, demo data Y/n). It prints your URLs at the end.
7. **Kutt, right away:** the first visitor to `https://go.<ip>.sslip.io` becomes Kutt's admin, so open it immediately and create the admin account. Then:
   - Settings → API → generate a key.
   - `nano deploy/.env` → `KUTT_API_KEY=<key>`
   - `sudo ./deploy/bootstrap.sh`
8. **Updates later:** `git pull && sudo ./deploy/bootstrap.sh`

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
