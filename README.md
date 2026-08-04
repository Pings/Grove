# Grove

Grow your Chinese in a quiet garden of words.

Local Vite + React learning app (HSK-focused): Shelf, Gather, Tend, Temper, Forms.

## Where data lives

| Data | Default | Optional |
|------|---------|----------|
| Word list (Shelf / Lines) | Browser IndexedDB | Sync server |
| Quiz questions (Forms) | Browser IndexedDB | Sync server |
| Gemini API key & settings | Browser localStorage | Always local |

**This browser** — each phone/laptop keeps its own copy (export/import JSON to move).

**Sync to server** — Settings → Library storage → run the sync container, then enter its URL + a shared sync key on every device.

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

- Tailscale / LAN: `http://<truenas-ip>:8080` (or whatever host port you set, e.g. `8081`)
- Sync API: `http://<truenas-ip>:8090`

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

### Sync across devices

In Grove → **Settings** → **Library storage** → **Sync to server**:

- URL: your sync server (e.g. `http://<truenas-ip>:8090`)
- **Profiles**: first profile is **Nikko** (keeps your existing library/key). Create more for separate empty libraries.
- Switching profile loads that profile’s words + quiz questions from the server (or starts empty).
- **Test connection** → **Sync now**

Edits upload automatically after a short pause.

