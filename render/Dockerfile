FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

# Prevent Playwright npm install from downloading browsers again
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Create a minimal Node project and install the Playwright JS package
RUN npm init -y \
 && npm install playwright@1.42.1 \
 && apt-get update \
 && apt-get install -y ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Copy your renderer script into the container
COPY render.js /app/render.js

ENTRYPOINT ["node", "/app/render.js"]