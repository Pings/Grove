# Xin (心)

Personal tools on one domain — hub at `/`, apps in subdirectories.

| Path | App |
|------|-----|
| `/` | **Xin** hub — floating links to each tool |
| `/grove/` | **Grove** — Chinese vocabulary garden |
| `/covet/` | **Covet** — wants & price tracker *(coming soon)* |
| `/api/` | Grove sync API (word DBs / profiles) |

One repo / one Docker stack on purpose: one Cloudflare tunnel, one TrueNAS deploy, shared nginx.

## Grove

Grow your Chinese in a quiet garden of words.

Vite + React (HSK-focused): Shelf, Gather, Tend, Temper, Forms. Lives at **`/grove/`**.

### Where Grove data lives

| Data | Location |
|------|----------|
| Word list & quiz questions | Grove server (`xin-sync`), same host as the site |
| Profiles (Nikko + extras) | Grove server — each profile is its own database |
| Gemini API key (and model / learned threshold) | Browser only |

There is no “this browser only” mode. Opening Grove loads the active profile from the server; edits save back automatically. Create a **new profile** only when you want a separate empty word database (Nikko stays as the main library).

### Local Grove dev

```bash
npm install
npm run dev
```

Open **`http://localhost:5173/grove/`** (Vite `base` is `/grove/`). The tools hub is only served from the Docker/nginx image.

```bash
npm run bump   # 0.1.x → next patch (run before each push)
npm run build
```

## Deploy on TrueNAS (Dockge)

Dockge manages compose stacks from a **stacks folder**. Find yours in TrueNAS → **Apps** → **Dockge** → edit → **Storage** (e.g. `/mnt/Maru/Apps/Dockge/stacks`).

**1. Clone into the Dockge stacks path**

```bash
cd /mnt/Maru/Apps/Dockge/stacks
sudo git clone https://github.com/Pings/Xin.git xin
cd xin
sudo cp docker-compose.yml compose.yaml
```

If you still have a stack folder named `grove`, rename it (stop the stack in Dockge first):

```bash
cd /mnt/Maru/Apps/Dockge/stacks
sudo docker compose -f grove/compose.yaml down   # if it is running
sudo mv grove xin
cd xin
sudo git remote set-url origin https://github.com/Pings/Xin.git
sudo git fetch origin main
sudo git reset --hard origin/main
sudo cp docker-compose.yml compose.yaml
```

Then set in `.env`:

```env
DEPLOY_HOST_PATH=/mnt/Maru/Apps/Dockge/stacks/xin
XIN_PORT=8081
COMPOSE_PROFILES=cloudflare,watcher
```

(Replace old `GROVE_PORT` with `XIN_PORT` if present.)

**Word DB volume:** the sync volume is now `xin-sync-data`. If you already had data under the old `grove` stack, copy it once after the first deploy creates the new volume:

```bash
# Adjust volume names from: docker volume ls | grep sync
sudo docker run --rm \
  -v grove_grove-sync-data:/from \
  -v xin_xin-sync-data:/to \
  alpine sh -c 'cd /from && cp -a . /to/'
sudo docker restart xin-sync
```

Rescan / open the **xin** stack in Dockge and deploy again.

In Cloudflare Zero Trust, public hostname **`xin.marucat.net`** → service **`http://xin:80`**.

**2. Deploy in Dockge**

1. Open Dockge → **xin** (or **Scan Stacks Folder**).
2. Confirm `compose.yaml` loaded (full repo must include `Dockerfile`, `package.json`, `src/`, `hub/`).
3. **Deploy** (first build takes a few minutes).

**3. Open the apps**

- Xin hub: `http://<truenas-ip>:8081/` (or `XIN_PORT` in `.env`)
- Grove: `http://<truenas-ip>:8081/grove/`
- Public tunnel: `https://your.domain/` and `https://your.domain/grove/`

**4. Update from git**

Manual:

```bash
cd /mnt/Maru/Apps/Dockge/stacks/xin
sudo ./deploy/deploy.sh
```

Or force a rebuild even when already current:

```bash
cd /mnt/Maru/Apps/Dockge/stacks/xin
sudo FORCE_REBUILD=1 ./deploy/deploy.sh
```

If update fails with *local changes to compose.yaml would be overwritten*, Dockge edited the compose file. Fix once with a hard reset (keeps `.env`):

```bash
cd /mnt/Maru/Apps/Dockge/stacks/xin
sudo git fetch origin main
sudo git reset --hard origin/main
sudo cp docker-compose.yml compose.yaml
sudo ./deploy/deploy.sh
```

`compose.yaml` is local-only (gitignored). Git tracks `docker-compose.yml`; deploy copies it to `compose.yaml` after each update. Put ports and the tunnel token in `.env`, not in the compose file.

### Auto-update from git (recommended: deploy watcher)

A small **deploy-watcher** container polls `origin/main` and rebuilds only `xin` + `xin-sync` when the branch moves (same idea as Rubric Marker). It does **not** recreate cloudflared or itself, so the tunnel stays up.

**1. Put ports, tunnel, and watcher settings in `.env`:**

```bash
cd /mnt/Maru/Apps/Dockge/stacks/xin
sudo nano .env
```

Example:

```env
XIN_PORT=8081
SYNC_PORT=8090
COMPOSE_PROFILES=cloudflare,watcher
TUNNEL_TOKEN=your-token-here
DEPLOY_HOST_PATH=/mnt/Maru/Apps/Dockge/stacks/xin
DEPLOY_BRANCH=main
POLL_SECONDS=60
```

`DEPLOY_HOST_PATH` must be the **absolute host path** of this stack (Dockge bind-mounts it at the same path inside the watcher so `docker compose` via `docker.sock` works).

**2. Redeploy** in Dockge (or `docker compose --profile watcher up -d --build`). You should see `xin-deploy-watcher` alongside `xin` / `xin-sync`.

Logs: Dockge → xin-deploy-watcher, or `docker logs -f xin-deploy-watcher`.

Manual one-shot update is still available:

```bash
sudo ./deploy/deploy.sh
```

#### Fallback: host cron

If you prefer cron instead of the watcher container:

```bash
sudo ./deploy/install-cron.sh
```

Default schedule: **04:15 daily**. Logs: `deploy/update.log`. Don’t run both cron and the watcher unless you want competing updates.

### Public HTTPS with Cloudflare Tunnel

**1.** Cloudflare Zero Trust → **Networks** → **Tunnels** → create tunnel → copy token.

**2.** Public hostname: e.g. `xin.marucat.net` → HTTP → `http://xin:80` (Docker service name, not the host port).

**3.** Stack `.env` (Dockge env editor — one file for the whole stack):

```env
TUNNEL_TOKEN=paste-your-token-here
```

Simplest: remove the `profiles: [cloudflare]` block from `cloudflared` in compose so it always starts with the stack (as many Dockge setups do). Or set `COMPOSE_PROFILES=cloudflare,watcher` in `.env`.

**4.** Redeploy. You should see `xin`, `xin-sync`, `xin-cloudflared`, and (if enabled) `xin-deploy-watcher`.

Do **not** put `COMPOSE_PROFILES` or the token on the `xin` service — only on `.env` / `cloudflared`.

Bookmark **`/grove/`** after this layout change (the site root is now the tools hub).

### Profiles (word databases)

In Grove → **Settings** → **Word database**:

- **Nikko** is the default library on the server.
- **Create empty DB** makes a new profile with its own empty word list (does not copy Nikko).
- Switching profile loads that profile from the server.
- Edits save automatically; use **Reload from server** if you need a fresh pull.

Nginx proxies `/api` to `xin-sync`, so Cloudflare (and LAN) use the same site origin — no separate sync URL in the browser.

### Adding another tool

1. Build or drop static files under e.g. `apps/covet/dist` (Vite `base: '/covet/'`).
2. Copy them into the image at `/usr/share/nginx/html/covet/` (extend `Dockerfile`).
3. Add an nginx `location /covet/` (SPA `try_files` if needed).
4. Turn the Covet float button live in `hub/index.html` (remove `is-soon`).

### Notes

- Put **`XIN_PORT`** (and tunnel settings) in `.env` — auto-update regenerates `compose.yaml` from `docker-compose.yml` but keeps `.env`.
- **Gemini key**: Settings in each browser; restrict by HTTP referrer in [Google AI Studio](https://aistudio.google.com/) for your public URL.
- Auto-update tracks **`main`**.
- Hub brand lives in `hub/index.html` (**Xin** / **心**).
