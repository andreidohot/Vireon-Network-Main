# Migration from the previous Docker stack

This overlay must be copied over the full Vireon repository. It intentionally omits `.env`, runtime state and secret values.

```bash
cd /home/apps/vireon-network
cp -a vireon-release/vps-control-plane/.env /root/vireon-env-before-v2 2>/dev/null || true
cp -a vireon-release/vps-control-plane/state /root/vireon-state-before-v2

unzip /path/to/vireon-docker-control-plane-2.1.0-no-autoupdate.zip -d /tmp/vireon-v2
cp -a /tmp/vireon-v2/Vireon-Network-Main/. /home/apps/vireon-network/

cd /home/apps/vireon-network/vireon-release/vps-control-plane
chmod +x scripts/*.sh docker/*.sh docker/caddy/*.sh docker/backup-scheduler/*.sh
./scripts/repair-existing-installation.sh
```

The repair script removes the old updater script and updater container, removes old PostgreSQL/cAdvisor containers without deleting Vireon state, and moves any former `state/rollback` directory into `state/legacy-disabled/`.

Never use `docker compose down -v`.
