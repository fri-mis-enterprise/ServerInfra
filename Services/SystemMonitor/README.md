# SystemMonitor

Internal DCR month access dashboard. [PLAN.md](PLAN.md) defines the intended behavior; [docs/runbook.md](docs/runbook.md) covers operation and the staged write helper.

For development, install `requirements-dev.txt`, run `python -m pytest -q`, then start `python -m systemmonitor.worker` and `waitress-serve --listen=127.0.0.1:3000 --call systemmonitor.web:create_app`. The default path is `/systemmonitor/`.

The server uses the Python `dbf` package to change `ALLOW` when `ENABLE_WRITES=true`. Set it to `false` to run without DBF mutations. The writer serializes dashboard and worker operations but does not take locks used by external FoxPro clients.

This directory is part of the shared ServerInfra repository. Commit the application
source, tests, deployment files, documentation, and `.env.example`; the local
`.gitignore` excludes real secrets, runtime data, DBF copies, caches, and generated
files. Application source is needed because Docker Compose builds the image locally.
