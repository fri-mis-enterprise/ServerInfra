# n8n

n8n is deployed as an independent Docker Compose project and is accessed through the server's Caddy reverse proxy.

## Access

n8n is available at:

```text
https://192.168.0.254/n8n/
```

The container does not publish port `5678` to the host. Caddy reaches n8n through the shared Docker `proxy` network.

## Docker Compose

`docker-compose.yml`:

```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    environment:
      - N8N_SECURE_COOKIE=true
      - N8N_PATH=/n8n/
      - N8N_EDITOR_BASE_URL=https://192.168.0.254/n8n/
      - WEBHOOK_URL=https://192.168.0.254/n8n/
    volumes:
      - n8n_data:/home/node/.n8n
    restart: unless-stopped
    networks:
      - proxy

volumes:
  n8n_data:

networks:
  proxy:
    external: true
```

## Configuration

### `N8N_SECURE_COOKIE`

```text
N8N_SECURE_COOKIE=true
```

n8n uses secure cookies because it is served over HTTPS.

### `N8N_PATH`

```text
N8N_PATH=/n8n/
```

n8n is served under the `/n8n/` path instead of the root of the server.

The trailing slash is intentional.

### `N8N_EDITOR_BASE_URL`

```text
N8N_EDITOR_BASE_URL=https://192.168.0.254/n8n/
```

Defines the public URL used for the n8n editor.

### `WEBHOOK_URL`

```text
WEBHOOK_URL=https://192.168.0.254/n8n/
```

Defines the public base URL used when generating webhook URLs.

If the server's public address changes, these URLs must be updated.

## Networking

n8n is attached to the external Docker network:

```text
proxy
```

This allows Caddy to reach the container using its Compose service name:

```text
n8n:5678
```

The application port is intentionally not published to the host.

Do not add:

```yaml
ports:
  - "5678:5678"
```

unless direct host/LAN access is specifically required.

## Persistent Data

n8n stores its persistent data in the Docker volume:

```text
n8n_data
```

mounted at:

```text
/home/node/.n8n
```

This contains important n8n state and should be included in the server's backup strategy.

Do not remove the volume when recreating the container.

For example:

```bash
docker compose down
docker compose up -d
```

does not remove the named volume.

Avoid:

```bash
docker compose down -v
```

unless the n8n data is intentionally being deleted.

## Starting n8n

From this directory:

```bash
docker compose up -d
```

Check the container:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f n8n
```

## Updating n8n

Pull the latest image:

```bash
docker compose pull
```

Recreate the container:

```bash
docker compose up -d
```

Then verify:

```bash
docker compose ps
docker compose logs --tail=100 n8n
```

Because the Compose file currently uses:

```text
n8nio/n8n:latest
```

pulling the image may install a newer n8n release.

For production use, consider pinning a specific n8n version rather than relying on `latest`.

## Restarting

```bash
docker compose restart n8n
```

## Stopping

```bash
docker compose down
```

The named `n8n_data` volume remains intact.

## Caddy Integration

Caddy handles HTTPS and forwards requests from:

```text
/n8n/*
```

to:

```text
n8n:5678
```

The corresponding Caddy route is conceptually:

```caddyfile
handle_path /n8n/* {
    reverse_proxy n8n:5678
}
```

The exact Caddy configuration is maintained in the `caddy/` directory.

After changing Caddy configuration:

```bash
cd ~/caddy
docker compose reload caddy
```

## Troubleshooting

### Check n8n

```bash
docker compose ps
```

The container should be running.

### Check logs

```bash
docker compose logs --tail=100 n8n
```

For live logs:

```bash
docker compose logs -f n8n
```

### Check the Docker network

```bash
docker network inspect proxy
```

Both `n8n` and Caddy should be attached to the network.

### Test n8n from inside the Docker network

From the Caddy container:

```bash
docker compose exec caddy wget -qO- http://n8n:5678/healthz
```

If this succeeds, Docker networking between Caddy and n8n is working.

### Check the public endpoint

```bash
curl -kI https://192.168.0.254/n8n/
```

A successful response indicates that Caddy is serving the n8n endpoint.

## Recreating the Container

The container can safely be recreated as long as the named volume is retained:

```bash
docker compose down
docker compose up -d
```

The persistent n8n data remains in:

```text
n8n_data
```

## Backup Considerations

The Compose file itself is version controlled by Git.

The `n8n_data` Docker volume contains persistent application data and must be backed up separately.

Before performing destructive operations, verify the volume:

```bash
docker volume inspect n8n_n8n_data
```

The exact Docker volume name may vary depending on the Compose project name.

List volumes if necessary:

```bash
docker volume ls
```

## Important Notes

* n8n is accessed through Caddy, not directly through port `5678`.
* The `proxy` Docker network must exist before starting the service.
* The `/n8n/` path is intentional.
* The trailing slash in `N8N_PATH` and the public URL is intentional.
* Do not delete `n8n_data` unless the stored n8n data is no longer needed.
* Keep credentials and secrets out of Git.
* Changes to the server's IP or access URL require updating the n8n URL environment variables and the corresponding Caddy configuration.

