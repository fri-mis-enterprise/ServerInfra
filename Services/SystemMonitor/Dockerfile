FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY systemmonitor ./systemmonitor
RUN groupadd --gid 1000 monitor && useradd --uid 1000 --gid monitor --home-dir /app monitor && mkdir /data && chown monitor:monitor /data
USER monitor
EXPOSE 3000
CMD ["waitress-serve", "--listen=0.0.0.0:3000", "--call", "systemmonitor.web:create_app"]
