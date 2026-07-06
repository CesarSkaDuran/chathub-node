---
name: testing-chathub-api
description: Set up and test the ChatHub Node API (Express + Knex + MySQL/MariaDB + Socket.io) end-to-end. Use when verifying backend/API changes to chathub-node.
---

# Testing ChatHub API

Backend-only API. Test via HTTP (curl + jq) — there is no frontend in this repo, so
**do not record** (shell-only). Collect curl outputs as text evidence.

## Local setup (no WAMP needed on Linux)

The README assumes Windows/WAMP + MySQL as `root` with no password. On a Linux box use MariaDB:

```bash
sudo apt-get update && sudo apt-get install -y mariadb-server
sudo service mariadb start            # systemd is usually not running in the container
sudo mysql -e "CREATE DATABASE IF NOT EXISTS chathub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS 'chathub'@'127.0.0.1' IDENTIFIED BY 'chathubpass';
  GRANT ALL PRIVILEGES ON chathub.* TO 'chathub'@'127.0.0.1'; FLUSH PRIVILEGES;"
```

Point `.env` at that user (temporary test edit, do NOT commit): `DB_USER=chathub`, `DB_PASSWORD=chathubpass`.
Then `npm install` and `node src/index.js` — it auto-runs migrations + seed on first boot
and prints test users (all password `password`): admin@chathub.com, supervisor@chathub.com,
agente.norte@chathub.com (branch Norte), agente.sur@chathub.com (branch Sur).

Health check: `curl -s localhost:3000/health` → `{"status":"ok",...}`.

## Auth pattern

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@chathub.com","password":"password"}' | jq -r .token)
curl -s localhost:3000/api/conversations -H "Authorization: Bearer $TOKEN" | jq .
```

## High-value assertions (adversarial)

- **Branch scoping (`scopeByBranch`)** is the most important invariant: admin sees all
  conversations/channels/agents; an `agent` sees ONLY their branch. With the default seed:
  admin `/conversations` total = 7, agente.norte = 4 (Norte channels only), agente.sur = 3
  (Sur channels only). A broken scope shows the same total for everyone.
- **Pagination**: `?limit=2&page=1` vs `page=2` must return `{total,page,limit}` and different ids.
- **Auth response**: login `user` must include `branch_name`/`branch_slug` and must NOT include `password`.
- **Validation**: missing required fields → 400 with the endpoint's Spanish message
  (e.g. `"Email y password requeridos"`, `"Todos los campos son requeridos"`).
- **timestamps/touch**: a PUT `/conversations/:id/status` must bump `updated_at`.

## Gotchas / maybe-broken areas

- `channel.reconnect` historically referenced `rmSync`/`join` without importing them → 500 ReferenceError.
  If reconnect 500s, check the `fs`/`path` imports in `channel.controller.js`.
- Live WhatsApp send + true inbound ingestion (`inbound.service.js`) need a real Baileys/WhatsApp
  session and can't be fully tested locally; verify those paths structurally (`node --check` + import).
- No lint/test/build scripts exist; `node --check src/**/*.js` and an import smoke-test are the CI substitute.

## Devin Secrets Needed
None. The app runs entirely against a local DB with the committed `.env` defaults (JWT secret is a placeholder).
