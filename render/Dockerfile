FROM mcr.microsoft.com/playwright:v1.42.1-jammy

RUN apt-get update \
  && apt-get install -y ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY render.js /app/render.js

ENTRYPOINT ["node", "/app/render.js"]