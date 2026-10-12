FROM node:22-alpine AS frontend
WORKDIR /build
RUN npm install -g typescript@5.9.3
COPY frontend/tsconfig.json frontend/
COPY frontend/ts frontend/ts
RUN tsc -p frontend --sourceMap false

FROM php:8.3-cli
RUN docker-php-ext-install pdo_mysql \
    && apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY analytics/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
COPY . .
COPY --from=frontend /build/frontend/js frontend/js
ENV DB_HOST=db PYTHON_BIN=/opt/venv/bin/python
EXPOSE 8000
CMD php backend/bin/seed.php --if-empty \
    && /opt/venv/bin/python analytics/forecast.py --status-file backend/storage/forecast_status.json \
    ; exec php -S 0.0.0.0:8000 server.php
