# Apply Veiron Docker Control Plane 2.1.0-no-autoupdate

```bash
unzip veiron-docker-control-plane-2.1.0-no-autoupdate.zip -d /tmp/veiron-v2
cp -a /tmp/veiron-v2/Veiron-Network-Main/. /path/to/Veiron-Network-Main/
cd /path/to/Veiron-Network-Main/veiron-release/vps-control-plane
chmod +x scripts/*.sh docker/*.sh docker/caddy/*.sh docker/backup-scheduler/*.sh
./scripts/repair-existing-installation.sh
```

For a fresh VPS, run `./scripts/install-docker-stack.sh` instead of the repair script. Preserve the existing `.env` and `state/` directory during an upgrade. This archive intentionally does not include `.env` or secret values.

Automatic updates are absent. Do not add Watchtower, unattended `docker compose pull`, or a scheduled updater. Do not run `docker compose down -v`.
