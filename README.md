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

**Sync to server** — Settings → Library storage → run the sync container on TrueNAS, then enter its Tailscale URL + a shared sync key on every device.

## Sync server (TrueNAS / Dockge)

```bash
cd deploy
docker compose up -d --build
```

- App: `http://<tailscale-ip>:8080`
- Sync API: `http://<tailscale-ip>:8090`

In Grove → **Settings** → **Library storage** → **Sync to server**:

- URL: `http://<tailscale-ip>:8090`
- Sync key: any private string (≥ 8 characters), same on all devices
- **Test connection** → **Sync now**

Edits upload automatically after a short pause. On open, Grove pulls if the server copy is newer.
