# Grove

Grow your Chinese in a quiet garden of words.

Local Vite + React learning app (HSK-focused): Shelf, Gather, Tend, Temper, Forms.

## Where data lives

| Data | Location |
|------|----------|
| Word list & quiz questions | Grove server (`grove-sync`), same host as the site |
| Profiles (Nikko + extras) | Grove server — each profile is its own database |
| Gemini API key (and model / learned threshold) | Browser only |

There is no “this browser only” mode. Opening the site loads the active profile from the server; edits save back automatically. Create a **new profile** only when you want a separate empty word database (Nikko stays as the main library).

## Deploy on TrueNAS (Dockge)

Dockge manages compose stacks from a **stacks folder**. Find yours in TrueNAS → **Apps** → **Dockge** → edit → **Storage** (e.g. `/mnt/Maru/Apps/Dockge/stacks`).

**1. Clone into the Dockge stacks path**

```bash
cd /mnt/Maru/Apps/Dockge/stacks
sudo git clone https://github.com/Pings/Grove.git grove
cd grove
sudo cp docker-compose.yml compose.yaml
```

**2. Deploy in Dockge**

1. Open Dockge → **grove** (or **Scan Stacks Folder**).
2. Confirm `compose.yaml` loaded (full repo must include `Dockerfile`, `package.json`, `src/`).
3. **Deploy** (first build takes a few minutes).

**3. Open the app**

- LAN: `http://<truenas-ip>:8080` (or whatever host port you set, e.g. `8081`)
- Public tunnel: your Cloudflare hostname (API is same-origin via `/api`)

**4. Update from git**

Manual:

```bash
cd /mnt/Maru/Apps/Dockge/stacks/grove
sudo ./deploy/deploy.sh
```

Or force a rebuild even when already current:

```bash
cd /mnt/Maru/Apps/Dockge/stacks/grove
sudo FORCE_REBUILD=1 ./deploy/deploy.sh
```

### Auto-update from git (recommended)

Keeps TrueNAS on latest `main` without typing commands. Ports and tunnel token stay in `.env` (`GROVE_PORT`, `TUNNEL_TOKEN`) so updates don’t wipe them.

**1. Put your host port + tunnel in `.env`** (once):

```bash
cd /mnt/Maru/Apps/Dockge/stacks/grove
sudo nano .env
```

Example:

```env
GROVE_PORT=8081
SYNC_PORT=8090
COMPOSE_PROFILES=cloudflare
TUNNEL_TOKEN=your-token-here
```

**2. Install the daily cron job** (as root):

```bash
cd /mnt/Maru/Apps/Dockge/stacks/grove
sudo chmod +x deploy/deploy.sh deploy/install-cron.sh
sudo ./deploy/install-cron.sh
```

Default schedule: **04:15 daily**. Logs: `deploy/update.log`.

**3. Optional — TrueNAS UI cron instead**

System → Advanced → Cron Jobs → add:

| Field | Value |
|-------|-------|
| Command | `/mnt/Maru/Apps/Dockge/stacks/grove/deploy/deploy.sh >> /mnt/Maru/Apps/Dockge/stacks/grove/deploy/update.log 2>&1` |
| Schedule | e.g. daily 4:15 AM |
| User | `root` |

The script **skips** when there is nothing new on `origin/main`, so it’s safe to run often.

### Public HTTPS with Cloudflare Tunnel

**1.** Cloudflare Zero Trust → **Networks** → **Tunnels** → create tunnel → copy token.

**2.** Public hostname: your domain → HTTP → `grove:80` (Docker service name, not the host port).

**3.** Stack `.env` (Dockge env editor — one file for the whole stack):

```env
TUNNEL_TOKEN=paste-your-token-here
```

Simplest: remove the `profiles: [cloudflare]` block from `cloudflared` in compose so it always starts with the stack (as many Dockge setups do). Or set `COMPOSE_PROFILES=cloudflare` in `.env`.

**4.** Redeploy. You should see `grove`, `grove-sync`, and `grove-cloudflared`.

Do **not** put `COMPOSE_PROFILES` or the token on the `grove` service — only on `.env` / `cloudflared`.

### Profiles (word databases)

In Grove → **Settings** → **Word database**:

- **Nikko** is the default library on the server.
- **Create empty DB** makes a new profile with its own empty word list (does not copy Nikko).
- Switching profile loads that profile from the server.
- Edits save automatically; use **Reload from server** if you need a fresh pull.

Nginx proxies `/api` to `grove-sync`, so Cloudflare (and LAN) use the same site origin — no separate sync URL in the browser.

### Notes

- Put **`GROVE_PORT`** (and tunnel settings) in `.env` — auto-update overwrites `compose.yaml` from git but keeps `.env`.
- **Gemini key**: Settings in each browser; restrict by HTTP referrer in [Google AI Studio](https://aistudio.google.com/) for your public URL.
- Auto-update tracks **`main`**.

