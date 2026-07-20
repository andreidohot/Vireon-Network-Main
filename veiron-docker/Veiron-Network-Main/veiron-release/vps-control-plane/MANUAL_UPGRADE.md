# Manual upgrades only

This package contains no automatic updater. There is no Watchtower, updater service, scheduled pull, mutable `latest` default, update endpoint, rollback endpoint, or update button. Cloudflared is started with `--no-autoupdate`.

An upgrade is an explicit operator procedure:

```bash
cd /home/apps/veiron-network/veiron-release/vps-control-plane
./scripts/backup-now.sh
git status
git fetch --all --tags
# Review and explicitly check out the chosen commit or tag.
./scripts/validate-stack.sh --require-docker
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env -f compose.yaml --profile cloudflare --profile pool --profile backup up -d --build
./scripts/health-check-docker.sh
```

Do not use `docker compose down -v`. A source rollback is also manual: restore the reviewed Git commit and the matching configuration backup, rebuild, then run health checks.
