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

```bash
cd /mnt/Maru/Apps/Dockge/stacks/grove
sudo git fetch origin
sudo git checkout main
sudo git reset --hard origin/main
sudo cp docker-compose.yml compose.yaml
sudo ./deploy/deploy.sh
```

Then Dockge → **Deploy** if needed. Dockge does **not** `git pull` for you.

**Important:** the stack folder must be the **full git repo**. If Dockge only has `compose.yaml`, re-clone into that folder.

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

- URL: `http://<truenas-ip>:8090` (or a Tailscale IP; keep sync off the public tunnel unless you add auth)
- Sync key: any private string (≥ 8 characters), same on all devices
- **Test connection** → **Sync now**

### Auto-pull (optional)

TrueNAS cron as `root`:

```bash
/mnt/Maru/Apps/Dockge/stacks/grove/deploy/deploy.sh >> /mnt/Maru/Apps/Dockge/stacks/grove/deploy.log 2>&1
```

### Notes

- Change the published port in compose if `8080` is taken (e.g. `8081:80`).
- **Gemini key**: Settings in each browser; restrict by HTTP referrer in [Google AI Studio](https://aistudio.google.com/) for your public URL.
- Prefer keeping work on **`main`** — pull `main` on TrueNAS after merges.
