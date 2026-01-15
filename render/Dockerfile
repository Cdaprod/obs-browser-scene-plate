FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

# Copy renderer script
COPY render.js /app/render.js

# Playwright image already includes:
# - Node
# - Playwright
# - Chromium
# - Required system deps

# Install ffmpeg for encoding
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["node", "/app/render.js"]