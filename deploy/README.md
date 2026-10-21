# Deploying Hook on a VPS

Everything in this folder runs the backend with Docker Compose on one server:
three API copies behind Nginx, one background worker, and Redis.

## First-time setup

```bash
git clone https://github.com/Hook-Deliveries/Hook-Backend.git ~/hook-backend
cd ~/hook-backend/deploy
cp ../.env.example .env          # fill in production values
echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> .env
chmod 600 .env
docker compose up -d --build
curl -s localhost/health
```

`REDIS_URL` in `.env` is ignored: Compose points every process at the local
Redis container.

## Deploying a new version

```bash
~/hook-backend/deploy/deploy.sh            # deploys origin/main
~/hook-backend/deploy/deploy.sh <commit>   # deploys a specific commit
```

The script replaces `api-1`, `api-2` and `api-3` one at a time and waits for
each to pass `/health`, so Nginx always has a healthy copy to send traffic to.
If a copy fails to start, the previous image is restored.

## Automatic deploys

`.github/workflows/deploy.yml` runs after CI passes on `main` (or by hand from
the Actions tab). It connects as `deploy` with a key that the server restricts
to one forced command, `deploy/deploy.sh <sha>`: the key cannot open a shell.
Repository secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`.

## Useful commands

```bash
docker compose ps                    # status of every container
docker compose logs -f --tail=100 api-1
docker compose restart worker
```
