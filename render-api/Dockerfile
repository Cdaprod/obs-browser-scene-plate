FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

RUN npm init -y && npm install playwright@1.42.1

COPY render-api/render.js /app/render.js
COPY render-api/server.js /app/server.js

EXPOSE 8791
CMD ["node", "/app/server.js"]
