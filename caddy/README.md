# Caddy

Caddy is the reverse proxy and HTTPS entry point for services running on the server.

It runs as a Docker container and connects to services through the shared external Docker network `proxy`.

## Directory

```text
caddy/
├── docker-compose.yml
├── Caddyfile
└── README.md
```

## Requirements

* Arch Linux
* Docker Engine
* Docker Compose
* An existing Docker network named `proxy`

Create the network if it does not already exist:

```bash
docker network create proxy
```

Verify:

```bash
docker network ls
```

---

## Docker Compose

`docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - proxy
    restart: unless-stopped

volumes:
  caddy_data:
  caddy_config:

networks:
  proxy:
    external: true
```

### Volumes

Caddy uses two persistent Docker volumes:

* `caddy_data` — certificates, internal CA data, and other runtime data
* `caddy_config` — Caddy configuration state

These volumes should not be removed during normal maintenance.

---

## Caddyfile

The current configuration uses the server's IP address as the HTTPS endpoint.

```caddyfile
{
    debug
    default_sni 192.168.0.254
}

192.168.0.254 {
    redir /n8n /n8n/ 308

    handle_path /n8n/* {
        reverse_proxy n8n:5678
    }
}
```

### Global options

```caddyfile
{
    debug
    default_sni 192.168.0.254
}
```

`debug` enables additional logging, which is useful while troubleshooting.

`default_sni` ensures that clients connecting directly to the IP address without sending SNI are handled using the expected server identity.

This is particularly important when accessing Caddy through:

```text
https://192.168.0.254
```

instead of a domain name.

---

## Routing

Caddy routes services based on URL paths.

For example:

```caddyfile
handle_path /example/* {
    reverse_proxy example:8080
}
```

A request to:

```text
https://192.168.0.254/example/
```

is forwarded to:

```text
example:8080
```

Because `handle_path` strips the matched path prefix, the upstream receives the request without `/example`.

### Trailing slash redirect

The configuration includes:

```caddyfile
redir /n8n /n8n/ 308
```

This redirects:

```text
/n8n
```

to:

```text
/n8n/
```

This is necessary because the path handler matches `/n8n/*`, while `/n8n` itself does not match it.

---

## Adding a New Service

Services that should be accessible through Caddy should normally **not publish their application port to the host**.

Instead, attach the service to the shared `proxy` network.

Example:

```yaml
services:
  example:
    image: example/image:latest
    restart: unless-stopped
    networks:
      - proxy

networks:
  proxy:
    external: true
```

Then add a route to the Caddyfile:

```caddyfile
192.168.0.254 {
    handle_path /example/* {
        reverse_proxy example:8080
    }
}
```

The service name used by Caddy:

```text
example
```

must match the Docker Compose service name.

Caddy can then reach it internally through Docker DNS.

---

## Network Architecture

The intended architecture is:

```text
Client
  │
  │ HTTPS :443
  ▼
┌──────────────────────┐
│        Caddy         │
│      :80 / :443      │
└──────────┬───────────┘
           │
           │ Docker network: proxy
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
   n8n:5678   other-service
```

Only Caddy needs to expose ports `80` and `443` on the host.

Application containers communicate with Caddy through the `proxy` network.

---

## HTTPS

Caddy handles HTTPS automatically.

For the current IP-based setup, Caddy uses its internal certificate authority rather than a public certificate authority.

This means browsers may initially display a certificate/security warning because the Caddy internal CA is not automatically trusted by client machines.

Once the Caddy root certificate is trusted on a client, the warning disappears.

### Root CA

The Caddy root certificate is stored inside the Caddy data volume at:

```text
/data/caddy/pki/authorities/local/root.crt
```

To display it:

```bash
docker compose exec caddy \
    cat /data/caddy/pki/authorities/local/root.crt
```

The certificate can then be installed into the operating system's trusted CA store.

For Arch Linux, the certificate can be placed under:

```text
/etc/ca-certificates/trust-source/anchors/
```

Then update the trust store:

```bash
sudo update-ca-trust
```

Client trust is optional if the certificate warning is acceptable.

---

## Starting Caddy

From the `caddy/` directory:

```bash
docker compose up -d
```

Check the container:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f caddy
```

---

## Restarting Caddy

Restart:

```bash
docker compose restart caddy
```

Or recreate the container:

```bash
docker compose up -d
```

---

## Updating Caddy

Pull the latest image:

```bash
docker compose pull
```

Recreate the container:

```bash
docker compose up -d
```

Verify:

```bash
docker compose ps
```

Check logs if necessary:

```bash
docker compose logs -f caddy
```

The `caddy:2` image currently tracks the latest Caddy 2 release.

For production environments where predictable updates are preferred, consider pinning a specific Caddy version.

---

## Validating the Configuration

Before restarting after modifying the Caddyfile, validate it:

```bash
docker compose exec caddy caddy validate \
    --config /etc/caddy/Caddyfile
```

You can also format the configuration:

```bash
docker compose exec caddy caddy fmt \
    --overwrite /etc/caddy/Caddyfile
```

Then restart:

```bash
docker compose restart caddy
```

---

## Testing HTTPS

Test from the server:

```bash
curl -kI https://192.168.0.254/
```

Test a proxied service:

```bash
curl -kI https://192.168.0.254/example/
```

The `-k` option allows testing when the client's trust store does not yet trust Caddy's internal CA.

---

## Troubleshooting

### Check Caddy status

```bash
docker compose ps
```

### View Caddy logs

```bash
docker compose logs -f caddy
```

### Check the Docker network

```bash
docker network inspect proxy
```

Caddy and the target service should both appear as connected containers.

### Check whether Caddy can resolve a service

For example:

```bash
docker compose exec caddy \
    ping -c 1 n8n
```

If the service cannot be resolved, verify that both containers are connected to `proxy`.

### Check Caddy configuration

```bash
docker compose exec caddy caddy validate \
    --config /etc/caddy/Caddyfile
```

### Check listening ports

On the host:

```bash
sudo ss -tulpn | grep -E ':80|:443'
```

Caddy should be listening on:

```text
0.0.0.0:80
0.0.0.0:443
```

---

## Common Problems

### `502 Bad Gateway`

Usually means Caddy cannot reach the upstream service.

Check:

```bash
docker network inspect proxy
```

Then verify the service is running:

```bash
docker compose ps
```

Also verify that the upstream hostname and port in the Caddyfile are correct.

Example:

```caddyfile
reverse_proxy n8n:5678
```

The hostname must correspond to a Docker service/container reachable through `proxy`.

### Certificate errors

If HTTPS works but the browser reports that the certificate is not trusted, install Caddy's local root CA on the client.

The certificate can be obtained with:

```bash
docker compose exec caddy \
    cat /data/caddy/pki/authorities/local/root.crt
```

### Requests to `/example` fail but `/example/` works

Add a redirect:

```caddyfile
redir /example /example/ 308
```

### Caddy cannot find a certificate for an unexpected IP

For raw-IP access, make sure the global configuration contains:

```caddyfile
default_sni 192.168.0.254
```

This handles clients that do not provide the expected SNI value.

---

## Configuration Changes

After modifying `Caddyfile`:

1. Validate the configuration.
2. Restart Caddy.
3. Check the logs.
4. Test the affected route.

Commands:

```bash
docker compose exec caddy caddy validate \
    --config /etc/caddy/Caddyfile

docker compose restart caddy

docker compose logs -f caddy
```

---

## Git

The Caddy configuration is version-controlled.

Tracked files:

```text
caddy/
├── docker-compose.yml
├── Caddyfile
└── README.md
```

Check changes:

```bash
git status
```

Review changes:

```bash
git diff
```

Commit:

```bash
git add caddy/
git commit -m "Update Caddy configuration"
```

Do not commit generated certificates, private keys, or Docker volume contents.

---

## Backup Considerations

The Caddy configuration itself is stored in Git:

```text
docker-compose.yml
Caddyfile
README.md
```

The Docker volumes contain Caddy runtime data, including its certificate authority and certificates.

List the volumes:

```bash
docker volume ls | grep caddy
```

Inspect a volume:

```bash
docker volume inspect caddy_caddy_data
```

The exact volume name may differ depending on the Compose project name.

For this IP-based internal setup, the Caddy configuration can be recreated from Git, but preserving the Caddy data volume avoids unnecessarily regenerating certificates and the internal CA.

---

## Design Principles

This Caddy setup follows a few simple rules:

1. Caddy is the single HTTP/HTTPS entry point.
2. Application containers communicate through the shared `proxy` network.
3. Reverse-proxied applications normally do not publish ports to the host.
4. Services are accessed through path-based routing.
5. Configuration files are version-controlled with Git.
6. Persistent Caddy data is stored in Docker volumes.
7. Caddy handles HTTPS centrally.
8. Each service should maintain its own README documenting its application-specific configuration.

This keeps the infrastructure simple while allowing additional Docker services to be added without exposing individual application ports.

