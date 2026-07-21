# Grove

Grow your Chinese in a quiet garden of words.

Local Vite + React learning app (HSK-focused): Shelf, Gather, Tend, Temper, Forms.

## Deploy on TrueNAS (Docker + Tailscale)

Grove is a static site — no backend. Data lives in each browser (IndexedDB). Access over your tailnet at `http://<truenas-tailscale-ip>:8080`.

### 1. Clone on TrueNAS

SSH into TrueNAS (or open the shell) and pick a dataset path, e.g. `/mnt/tank/apps`:

```bash
mkdir -p /mnt/tank/apps
cd /mnt/tank/apps
git clone <your-repo-url> grove
cd grove
```

### 2. Build and start

Requires Docker (TrueNAS SCALE has this built in):

```bash
docker compose up -d --build
```

Open `http://<truenas-tailscale-ip>:8080` from a device on your tailnet. Enter your Gemini API key in **Settings** on each browser/device.

### 3. Pull updates manually

From the repo directory:

```bash
./deploy/deploy.sh
```

This runs `git pull`, rebuilds the image, and restarts the container.

### 4. Auto-pull on a schedule (optional)

On TrueNAS SCALE, add a **Cron Job** (System Settings → Advanced → Cron Jobs, or Tasks):

| Field | Value |
|-------|-------|
| Command | `/mnt/tank/apps/grove/deploy/deploy.sh >> /mnt/tank/apps/grove/deploy.log 2>&1` |
| Schedule | e.g. daily at 3:00 AM, or every 6 hours |
| User | `root` |

Or from the shell, append to root’s crontab (`crontab -e`):

```cron
0 3 * * * /mnt/tank/apps/grove/deploy/deploy.sh >> /mnt/tank/apps/grove/deploy.log 2>&1
```

### Notes

- **Port 8080** is only on your tailnet — no public reverse proxy needed if you use Tailscale on phone/work.
- **Progress sync**: use Settings → export backup; each browser keeps its own library unless you restore a backup.
- **Gemini key**: restrict by HTTP referrer in [Google AI Studio](https://aistudio.google.com/) if you want extra safety.
