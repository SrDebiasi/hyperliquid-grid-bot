FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Edmonton
ENV PM2_HOME=/app/.pm2

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    git \
    bash \
    nano \
    tzdata \
    postgresql \
    postgresql-contrib \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update && apt-get install -y nodejs \
    && npm install -g pm2 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/docker /app/data/postgres /app/logs /app/.pm2

RUN chmod +x /app/docker/entrypoint.sh /app/docker/setup-env.sh

EXPOSE 3000 5432

ENTRYPOINT ["/app/docker/entrypoint.sh"]
