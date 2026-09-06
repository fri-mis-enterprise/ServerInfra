# Server Infrastructure

Infrastructure configuration for the server, managed directly with Docker Compose and Git.

The repository intentionally keeps application-specific configuration out of the root documentation. Each service should document its own setup inside its directory.

## Repository Structure

```text
.
├── README.md
│
├── caddy/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── README.md
│
├── <service>/
│   ├── docker-compose.yml
│   └── README.md
│
└── <service>/
    ├── docker-compose.yml
    └── README.md
```

The root README documents the infrastructure conventions. Individual service directories document the applications themselves.

---

## Infrastructure

The server uses:

- Arch Linux
- Docker Engine
- Docker Compose
- Caddy
- Git

Docker Compose is used independently for each service rather than maintaining one large Compose project.

This keeps services isolated and makes it possible to start, stop, update, or troubleshoot them independently.

## Shared Docker Network

A shared external Docker network named `proxy` is used for services that need to communicate with the reverse proxy.

Create it once:

```bash
docker network create proxy
```

Check that it exists:

```bash
docker network ls
```

Because it is an external network, individual Compose projects must not attempt to create or manage it.

### Compose configuration

A service that needs to be reachable by the reverse proxy should include:

```yaml
services:
  app:
    image: example/image:latest
    networks:
      - proxy

networks:
  proxy:
    external: true
```

The important parts are:

```yaml
networks:
  - proxy
```

under the service, and:

```yaml
networks:
  proxy:
    external: true
```

at the Compose level.

The service name becomes the hostname available to other containers on the `proxy` network.

For example, if the service is named `app`, the reverse proxy can connect to:

```text
app:<container-port>
```

Do not use the server's LAN IP for communication between containers when both containers are attached to `proxy`.

## Service Ports

A service does **not** need to publish its application port to the host when it is only accessed through the reverse proxy.

Prefer:

```yaml
services:
  app:
    image: example/image:latest
    networks:
      - proxy
```

instead of:

```yaml
ports:
  - "8080:8080"
```

when direct LAN access is unnecessary.

The application port only needs to be exposed inside the container/network.

Publish a host port only when the service genuinely needs direct access from outside Docker.

## Reverse Proxy Integration

Caddy is the entry point for HTTP/HTTPS services.

The general flow is:

```text
Client
  │
  ▼
Server :80/:443
  │
  ▼
Caddy
  │
  ▼
proxy network
  │
  ▼
service container
```

When adding a web service:

1. Attach the service to `proxy`.
2. Determine the application's internal listening port.
3. Add a route to the Caddy configuration.
4. Start the service.
5. Reload Caddy.
6. Test the route.

Example Caddy configuration:

```caddyfile
192.168.0.254 {
    handle_path /example/* {
        reverse_proxy app:8080
    }
}
```

The hostname used by `reverse_proxy` must match the Compose service name or another resolvable container hostname on the shared network.

## Creating a New Service

Create a directory for the service:

```bash
mkdir <service>
cd <service>
```

Create `docker-compose.yml`.

A basic reverse-proxied service can start with:

```yaml
services:
  app:
    image: example/image:latest
    restart: unless-stopped
    networks:
      - proxy

networks:
  proxy:
    external: true
```

Then start it:

```bash
docker compose up -d
```

Check it:

```bash
docker compose ps
docker compose logs --tail=100
```

Verify that it is connected to the shared network:

```bash
docker network inspect proxy
```

After configuring Caddy:

```bash
cd ~/caddy
docker compose reload caddy
```

## Compose Conventions

Unless a service requires something different, Compose files should generally follow these conventions.

### Restart policy

Use:

```yaml
restart: unless-stopped
```

for long-running services.

### Named volumes

Use named volumes for persistent application data when appropriate:

```yaml
services:
  app:
    image: example/image:latest
    volumes:
      - app_data:/data

volumes:
  app_data:
```

Document important volumes in the service's README.

### Environment variables

Prefer an `.env` file for non-secret configuration when it makes the Compose file easier to maintain:

```yaml
services:
  app:
    env_file:
      - .env
```

Do not commit passwords, API keys, tokens, or other secrets to Git.

If a service requires an `.env` file, provide an `.env.example` containing the required variable names without real credentials.

## Directory Convention

Each service directory should contain everything necessary to understand and operate that service:

```text
service/
├── docker-compose.yml
├── README.md
├── .env.example
└── other configuration files
```

Do not place application-specific instructions in the root README.

The service README should explain:

- Purpose
- Image/container information
- Required environment variables
- Ports
- Volumes
- Networks
- Reverse proxy configuration
- Access URL/path
- Backup requirements
- Update procedure
- Troubleshooting

## Common Commands

### Start

```bash
docker compose up -d
```

### Stop

```bash
docker compose down
```

### Restart

```bash
docker compose restart
```

### View status

```bash
docker compose ps
```

### Follow logs

```bash
docker compose logs -f
```

### View recent logs

```bash
docker compose logs --tail=100
```

### Pull newer images

```bash
docker compose pull
```

### Update a service

```bash
docker compose pull
docker compose up -d
```

### Rebuild

For services that use a local Dockerfile:

```bash
docker compose up -d --build
```

## Troubleshooting

Work from the infrastructure layer upward.

### Host

```bash
systemctl --failed
df -h
free -h
```

### Docker

```bash
docker ps
docker info
docker network ls
```

### Service

From the service directory:

```bash
docker compose ps
docker compose logs --tail=100
```

### Network

```bash
docker network inspect proxy
```

Confirm that the reverse proxy and target service are both attached to the network.

### Reverse proxy

From the reverse proxy directory:

```bash
docker compose ps
docker compose logs --tail=100
```

If a proxy route cannot reach a service, first verify:

1. The service container is running.
2. Both containers are attached to `proxy`.
3. The Compose service name is correct.
4. The internal application port is correct.
5. The application is actually listening on that port.

## Backups

Docker Compose files contain infrastructure configuration, but they do not replace application data backups.

Persistent data should be backed up according to the requirements of each service.

Before removing a Docker volume, inspect it carefully:

```bash
docker volume ls
docker volume inspect <volume>
```

Never assume that deleting a container also deletes its persistent data, or that deleting a volume is safe.

Service-specific backup instructions belong in that service's README.

## Git

The repository is used to version-control infrastructure configuration.

Typical workflow:

```bash
git status
git add .
git commit -m "Update infrastructure"
git push
```

Keep secrets out of Git.

Recommended files to exclude include:

```text
.env
*.secret
```

Use `.env.example` files to document required configuration without storing credentials.

## Design Principles

This infrastructure intentionally avoids unnecessary management layers.

The preferred model is:

```text
Linux
  ↓
Docker
  ↓
Docker Compose
  ↓
Service
```

with Caddy providing the shared HTTP/HTTPS entry point when required.

Configuration should remain:

- Explicit
- Version controlled
- Reproducible
- Easy to inspect
- Easy to troubleshoot
- Independent between services

When adding infrastructure, prefer the simplest configuration that satisfies the requirement.

