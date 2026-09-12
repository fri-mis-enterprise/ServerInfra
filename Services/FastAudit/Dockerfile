FROM oven/bun:1.4-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip tzdata && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages dbfread
WORKDIR /app
COPY scanner /app/scanner
COPY web /app/web
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
EXPOSE 3000
CMD ["/app/entrypoint.sh"]
