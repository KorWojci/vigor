# Deployment, persistence, backup and upgrades

## Docker Compose

```bash
cp .env.example .env     # optional
docker compose up -d --build
docker compose logs -f vigor
```

- The image (`Dockerfile`) is a multi-stage build: dependencies → `next build` (standalone output) → a slim runtime running as the non-root user `vigor` (uid 1001).
- `/data` is a volume holding `vigor.db`, its WAL files and `backups/`. **All personal data lives there**; the container filesystem holds none.
- The health check calls `GET /api/healthz`; `docker compose ps` shows `healthy`.
- Changing the port: edit `ports:` in `docker-compose.yml` (host side), or set `PORT` and adjust both sides.

Persistence check: create a measurement, then run `docker compose down && docker compose up -d`. The data is still there. Only `docker compose down -v` (or `docker volume rm vigor_vigor-data`) deletes it.

### Bind mount instead of a named volume

```yaml
    volumes:
      - ./data:/data
```

The directory must be writable by uid 1001: `sudo chown -R 1001:1001 ./data`.

## Kubernetes

`deploy/k8s/vigor.yaml` contains a Namespace, a PersistentVolumeClaim (`vigor-data`, 5 Gi, ReadWriteOnce) mounted at `/data`, an optional Secret, a single-replica Deployment with `strategy: Recreate`, and a Service.

```bash
docker build -t registry.example.lan/vigor:0.1.0 . && docker push registry.example.lan/vigor:0.1.0
# edit image: and storageClassName in deploy/k8s/vigor.yaml
kubectl apply -f deploy/k8s/vigor.yaml
kubectl -n vigor port-forward svc/vigor 3000:80
```

Notes:

- **Exactly one replica.** SQLite has a single writer, and two pods on one volume would corrupt it. `Recreate` ensures the old pod stops before the new one starts.
- The pod runs non-root with a read-only root filesystem. `/app/.next/cache` and `/tmp` are `emptyDir` scratch space (no personal data).
- Readiness and liveness probes use `/api/healthz`.
- Expose it with an Ingress **with TLS** and keep it on the LAN or VPN. Set `VIGOR_SECURE_COOKIES=true` when served via HTTPS.
- Back up the PVC (Velero, or snapshot classes) or use the in-app backups described below.

## Reaching Vigor from the iPhone

- On the same network, `http://<server-LAN-IP>:3000` works. iOS allows plain HTTP to local addresses for the companion app (`NSAllowsLocalNetworking`) and for Shortcuts.
- A stable name helps: a DHCP reservation for the server and/or a local DNS name (router, Pi-hole, mDNS `hostname.local`).
- **Use HTTPS when** traffic crosses networks you don't fully trust (shared Wi-Fi, VPN gateways, other people's networks), when you access Vigor away from home, or when you set `VIGOR_SECURE_COOKIES=true`.
- **Never** port-forward Vigor to the internet without protection. For remote access, use a VPN (WireGuard, Tailscale) or a reverse proxy with TLS and an additional authentication layer.

### HTTPS and reverse proxies

Caddy (automatic local certificates with `tls internal`; install Caddy's root CA on the iPhone so it is trusted):

```
vigor.home.arpa {
  tls internal
  reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
server {
  listen 443 ssl;
  server_name vigor.home.arpa;
  ssl_certificate     /etc/ssl/vigor.crt;
  ssl_certificate_key /etc/ssl/vigor.key;
  client_max_body_size 12m;            # ≥ VIGOR_MAX_IMPORT_BYTES
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

When proxying, bind the container to localhost (`"127.0.0.1:3000:3000"`) and set `VIGOR_SECURE_COOKIES=true`. Vigor uses `X-Forwarded-For` for rate limiting, so only expose it through a proxy you control.

## Backup and restore

### What to back up

The single file `<data dir>/vigor.db`. Copies made while the server runs must be consistent, so use one of the methods below rather than `cp`.

### Creating backups

- **In the app:** Settings → Data → *Create backup now* writes `<data dir>/backups/vigor-manual-<timestamp>.db` (SQLite `VACUUM INTO`, consistent while online). Download it from the same page.
- **From the host (Docker), e.g. from cron:**

  ```bash
  docker compose exec -T vigor node -e "require('better-sqlite3')('/data/vigor.db').exec(\"VACUUM INTO '/data/backups/vigor-cron-$(date +%F).db'\")"
  docker compose cp vigor:/data/backups/vigor-cron-$(date +%F).db ./offsite/
  ```

- **Cold backup:** `docker compose stop`, copy the volume's `vigor.db` (and any `-wal` file), then `docker compose start`.
- **Kubernetes:** `kubectl -n vigor exec deploy/vigor -- node -e "…same VACUUM INTO…"`, then `kubectl cp`.

Backups contain your health data and password hash. Store them encrypted and off the server.

### Restoring

- **In the app:** Settings → Data → *Restore*. Vigor checks that the file is a Vigor database with a compatible schema and passes an integrity check, writes a `pre-restore` safety backup, swaps in the file and migrates it if it is older. You are signed out, because the backup has its own accounts.
- **Manually:** stop Vigor; replace `vigor.db` in the data directory; **delete** `vigor.db-wal` and `vigor.db-shm`; start Vigor.

### JSON export

Settings → Data → *Download JSON export*, or `GET /api/data/export` with a session. It includes all samples, workouts, sets, measurements, settings and import history, in canonical units. It excludes password hashes, sessions and token hashes. It is a portability format, not a restore format.

## Upgrades

```bash
git pull
docker compose up -d --build
```

- On start, pending migrations run automatically, after a snapshot to `backups/vigor-pre-migration-v<old>-<time>.db`.
- Downgrades are not supported once a newer schema has been applied. To go back, restore the pre-migration snapshot with the older image.
- Kubernetes: update the image tag. `Recreate` stops the old pod first.

## Operations checklist

- [ ] Persistent volume mounted at `/data`, or `VIGOR_DATA_DIR` set
- [ ] Time zone set in Settings → Application
- [ ] Regular backups copied off the host
- [ ] No direct internet exposure; HTTPS through a proxy or VPN for remote access
- [ ] `VIGOR_ADMIN_PASSWORD` removed after first start (if used)
