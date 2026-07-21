# Grove

Grow your Chinese in a quiet garden of words.

Local Vite + React learning app (HSK-focused): Shelf, Gather, Tend, Temper, Forms.

## Deploy on TrueNAS (Docker + Tailscale)

Grove is a static site — no backend. Data lives in each browser (IndexedDB). Access over your tailnet at `http://<truenas-tailscale-ip>:8080`.

### Option A — Dockge (recommended if you use it)

Dockge manages compose stacks from a **stacks folder**. Find yours in TrueNAS → **Apps** → **Dockge** → edit → **Storage** (often `/mnt/tank/apps/dockge/stacks`).

**1. Clone into the Dockge stacks path**

SSH or TrueNAS shell (replace the path with your Dockge stacks dataset):

```bash
cd /mnt/tank/apps/dockge/stacks
git clone https://github.com/Pings/Grove.git grove
```

**2. Create the stack in Dockge**

1. Open Dockge (**Apps** → **Dockge** → **Web UI**).
2. Click **+ Compose** (or **New Stack**).
3. Stack name: `grove` (must match the folder name if Dockge created it, or point at the `grove` folder).
4. Dockge should load `compose.yaml` / `docker-compose.yml` from that folder. If the editor is empty, paste the contents of `docker-compose.yml` from the repo.
5. Click **Deploy** (first build takes a few minutes).

**3. Open the app**

On a device with Tailscale: `http://<truenas-tailscale-ip>:8080`

**4. Update from git**

In Dockge → **grove** stack → **Terminal** (on the host), or SSH:

```bash
cd /mnt/tank/apps/dockge/stacks/grove
./deploy/deploy.sh
```

For auto-updates, use a TrueNAS cron job pointing at that same path (see below).

### Option B — CLI (no Dockge)

**1. Clone on TrueNAS**

SSH into TrueNAS (or open the shell) and pick a dataset path, e.g. `/mnt/tank/apps`:

```bash
mkdir -p /mnt/tank/apps
cd /mnt/tank/apps
git clone https://github.com/Pings/Grove.git grove
cd grove
```

**2. Build and start**

```bash
docker compose up -d --build
```

Open `http://<truenas-tailscale-ip>:8080` from a device on your tailnet. Enter your Gemini API key in **Settings** on each browser/device.

### Pull updates manually

From the repo directory (adjust path for Dockge vs CLI):

```bash
./deploy/deploy.sh
```

This runs `git pull`, rebuilds the image, and restarts the container.

### Auto-pull on a schedule (optional)

On TrueNAS SCALE, add a **Cron Job** (System Settings → Advanced → Cron Jobs):

| Field | Value |
|-------|-------|
| Command | `/mnt/tank/apps/dockge/stacks/grove/deploy/deploy.sh >> /mnt/tank/apps/dockge/stacks/grove/deploy.log 2>&1` |
| Schedule | e.g. daily at 3:00 AM, or every 6 hours |
| User | `root` |

(Use `/mnt/tank/apps/grove/...` instead if you deployed via CLI.)

Or from the shell, append to root’s crontab (`crontab -e`):

```cron
0 3 * * * /mnt/tank/apps/dockge/stacks/grove/deploy/deploy.sh >> /mnt/tank/apps/dockge/stacks/grove/deploy.log 2>&1
```

### Notes

- **Port 8080** is only on your tailnet — no public reverse proxy needed if you use Tailscale on phone/work.
- **Progress sync**: use Settings → export backup; each browser keeps its own library unless you restore a backup.
- **Gemini key**: restrict by HTTP referrer in [Google AI Studio](https://aistudio.google.com/) if you want extra safety.
- **Dockge rebuild**: after `git pull`, you must **rebuild** (Deploy in Dockge or `deploy.sh`) — Dockge does not auto-pull from git on its own.
