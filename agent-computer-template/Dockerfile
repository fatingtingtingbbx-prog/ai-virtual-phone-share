FROM docker.io/cloudflare/sandbox:0.12.4

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    jq \
    pandoc \
    poppler-utils \
    unzip \
    zip \
  && rm -rf /var/lib/apt/lists/*
