FROM oven/bun:1.4.2 AS interface
WORKDIR /interface
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend ./
ARG BASE_PATH=/systemmonitor
ENV BASE_PATH=$BASE_PATH
RUN bun run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY systemmonitor ./systemmonitor
COPY --from=interface /interface/build ./systemmonitor/frontend
RUN groupadd --gid 1000 monitor && useradd --uid 1000 --gid monitor --home-dir /app monitor && mkdir /data && chown monitor:monitor /data
USER monitor
EXPOSE 3000
CMD ["waitress-serve", "--listen=0.0.0.0:3000", "--call", "systemmonitor.web:create_app"]
