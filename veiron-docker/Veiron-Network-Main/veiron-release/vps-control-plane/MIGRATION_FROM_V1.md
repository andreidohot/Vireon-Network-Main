# Migration from the previous Docker stack

This overlay must be copied over the full Veiron repository. It intentionally omits `.env`, runtime state and secret values.

```bash
cd /home/apps/veiron-network
cp -a veiron-release/vps-control-plane/.env /root/veiron-env-before-v2 2>/dev/null || true
cp -a veiron-release/vps-control-plane/state /root/veiron-state-before-v2

unzip /path/to/veiron-docker-control-plane-2.1.0-no-autoupdate.zip -d /tmp/veiron-v2
cp -a /tmp/veiron-v2/Veiron-Network-Main/. /home/apps/veiron-network/

cd /home/apps/veiron-network/veiron-release/vps-control-plane
chmod +x scripts/*.sh docker/*.sh docker/caddy/*.sh docker/backup-scheduler/*.sh
./scripts/repair-existing-installation.sh
```

The repair script removes the old updater script and updater container, removes old PostgreSQL/cAdvisor containers without deleting Veiron state, and moves any former `state/rollback` directory into `state/legacy-disabled/`.

Never use `docker compose down -v`.
