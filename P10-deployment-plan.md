# P10 Deployment Plan — MothaShip to DigitalOcean

**Droplet:** 165.232.57.183
**Session:** p10-do-deployment
**Last updated:** 2026-03-12

---

## Status

| Step | Description | Status | Verified |
|------|-------------|--------|---------|
| 1 | JournalismReport schema | COMPLETE | commit 8b65c79 |
| 2 | Dual-lane API routes (`/api/v1/telemetry/hazmat` + `/api/v1/reports/dispatch`) | COMPLETE | commit 8b65c79 |
| 3 | DO droplet provisioning & server config | **IN PROGRESS** | 3A-3D done; nginx config copied; 3E-3G remain |
| 4 | Layer 4 cold-start seed (provision-model + seed-red-team) | TODO | — |
| 5 | Smoke test — all 4 AIMDS layers live | TODO | — |
| 6 | Update MEMORY.md with live endpoint URL | TODO | — |

---

## Pre-flight checklist (before touching the droplet)

- [ ] Confirm SSH key is loaded: `ssh-add -l`
- [ ] Confirm droplet is reachable: `ssh root@165.232.57.183 uptime`
- [ ] Confirm `GOOGLE_API_KEY` is available locally for .env copy
- [ ] `npx vitest run` passes locally (472/472 TS)

---

## Step 3 — Droplet provisioning

### 3A. SSH in and install dependencies

```bash
ssh root@165.232.57.183
# Install Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Rust (needed for WASM build)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
rustup target add wasm32-unknown-unknown

# Install PM2 for process management
npm install -g pm2
```

**Verification:** `node --version` → v20.x, `rustc --version`, `pm2 --version`

### 3B. Clone repo

```bash
cd /opt
git clone <repo-url> turbo-flow-claude
cd turbo-flow-claude
npm ci
```

**Verification:** `npm ci` exits 0, no peer dep errors.

### 3C. Create .env

```bash
cat > /opt/turbo-flow-claude/.env << 'EOF'
GOOGLE_API_KEY=<paste key>
COORDINATOR_MODEL=gemini-2.5-flash
WORKER_MODEL=gemini-2.5-flash
EOF
chmod 600 /opt/turbo-flow-claude/.env
```

**Verification:** `wc -l .env` → 3 lines. `stat .env | grep Uid` → owner root, mode 600.

### 3D. Build WASM corpus gate (Layer 1)

```bash
cd /opt/turbo-flow-claude
npm run build:mothership
```

**Verification:** `ls -la crates/wasm-security-gate/target/wasm32-unknown-unknown/release/*.wasm` — file exists, size > 0.

### 3E. Fix loopback bind for production

**Critical:** poc-server.ts currently binds to `127.0.0.1` (line 736). For DO, it must be reachable externally.

Option A — change bind address to `0.0.0.0` (direct exposure, firewall must be set):
```bash
# Edit line 736 in scripts/poc/poc-server.ts:
# server.listen(PORT, '127.0.0.1', ...) → server.listen(PORT, '0.0.0.0', ...)
```

Option B — keep `127.0.0.1` and put nginx in front (recommended for production):
```bash
apt-get install -y nginx
cat > /etc/nginx/sites-available/mothership << 'EOF'
server {
    listen 80;
    server_name 165.232.57.183;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
ln -s /etc/nginx/sites-available/mothership /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

**Decision needed before executing:** Option A or B? Option B is recommended — keeps the server off the public interface directly. Document choice here before proceeding.

**Verification (after choice):** `curl http://165.232.57.183/poc/stats` returns JSON.

### 3F. Create data directories

```bash
mkdir -p /opt/turbo-flow-claude/.claude-flow/data
mkdir -p /opt/turbo-flow-claude/data  # threats.db (aidefence Layer 2 persistence)
```

**Verification:** `ls -la .claude-flow/data/` exists and is writable.

### 3G. Start server with PM2

```bash
cd /opt/turbo-flow-claude
pm2 start "npx tsx scripts/poc/poc-server.ts --port 3000" \
  --name mothership \
  --log /var/log/mothership.log \
  --env production
pm2 save
pm2 startup  # follow printed instructions to enable on reboot
```

**Verification:** `pm2 status mothership` → online. `curl http://127.0.0.1:3000/poc/stats` → `{"total":0,"pending":0,...}`.

---

## Step 4 — Layer 4 cold-start seed (PRODUCTION TODO from CLAUDE.md)

Run these **before** marking Step 5 complete. Required for coherence layer.

```bash
cd /opt/turbo-flow-claude
npx tsx scripts/provision-model.ts
npx tsx scripts/seed-red-team.ts
```

**Verification:** `ls -la data/ruvbot-coherence.db` — file exists, size > 10MB (809 vectors × MiniLM embeddings). Run the excluded coherence tests locally before signing off:

```bash
# On local machine:
npx vitest run --reporter=verbose src/tests/red-team-coherence.spec.ts
npx vitest run --reporter=verbose src/tests/coherence-gate-wiring.spec.ts
npx vitest run --reporter=verbose src/tests/vector-scanner.spec.ts
```

All three must pass before P10 closes.

---

## Step 5 — Smoke test (all 4 AIMDS layers)

Run from local machine, targeting the live droplet:

```bash
# Layer 1 test — known-bad payload should be blocked by WASM corpus gate
npx tsx scripts/poc/mock-ruvbot.ts --all --target http://165.232.57.183/poc/submit

# Layer 2 test — novel attack (not in 809-vector corpus)
npx tsx scripts/poc/mock-ruvbot.ts --novel-attack --target http://165.232.57.183/poc/submit

# Layer 2 test — Sybil flood
npx tsx scripts/poc/mock-ruvbot.ts --sybil-flood --count 15 --target http://165.232.57.183/poc/submit

# Post-patch test — previously blocked fingerprint stays blocked
npx tsx scripts/poc/mock-ruvbot.ts --post-patch --target http://165.232.57.183/poc/submit
```

**Verification criteria (brutal honesty — do not advance until ALL pass):**
- [ ] Known-bad payload → `{"status":"blocked"}` or `{"status":"quarantined"}`
- [ ] NOVEL_ATTACK (`ADMIN_OVERRIDE_7749`) → reaches LLM Surgeon, verdict `privilege-escalation`, conf ≥ 0.9
- [ ] Sybil flood → EphemeralCache deduplicates; queue shows `variantCount` > 1 for matching fingerprints
- [ ] Post-patch → `{"status":"blocked"}` (approved-attacks Set blocks it)
- [ ] `curl http://165.232.57.183/poc/stats` → surgeon latency ~1.9s, aidefence showing hit counts
- [ ] `tail /var/log/mothership.log` — no unhandled errors, Layer 1 WASM corpus log present

---

## Step 6 — Update records

Once Step 5 passes:

1. Update `MEMORY.md` → MothaShip live endpoint: `http://165.232.57.183` (or update with FQDN if DNS is configured)
2. Update `CLAUDE.md` → remove `PRODUCTION TODO` from Section 3A Layer 4 entry
3. Commit: `git commit -m "feat(p10): MothaShip live on DO droplet 165.232.57.183"`

---

## Rollback

If smoke test fails:
```bash
pm2 stop mothership
pm2 delete mothership
```

Use `/rewind` in this session to undo any local file changes made during Step 3E.

---

## Notes

- **No RuvBot build until MothaShip endpoint is confirmed live** (per P10 deployment order in MEMORY.md)
- `threats.db` (aidefence Layer 2 persistence) lives at `./data/threats.db` — back up before any redeployment
- Internal hazmat log: `.claude-flow/data/internal_hazmat.jsonl` — check this after smoke test for self-interception events
- `@ruvector/mincut-wasm` still 404 on npm (verified 2026-03-11) — pure TS Stoer-Wagner is permanent
