# FAST Audit

## Deploy

```sh
cp .env.example .env
vi .env
chmod +x setup.sh
./setup.sh
```

`FAST_ROOT` must contain direct station folders with `DBASE/Sumpay.DBF` and `DBASE/ApLedger.DBF`. The source is mounted read-only. SQLite is preserved in `AUDIT_DATA`.

Open `http://server-address:${PORT}`.

Useful commands:

```sh
docker compose logs -f
docker compose ps
docker compose down
```

The first scan creates a silent baseline. Later scans record INSERT, UPDATE, and DELETE events with compressed old/new values.
