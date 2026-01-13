# Minimal static web server for OBS Browser Source pages
FROM nginx:alpine

# Nginx serves /usr/share/nginx/html by default
# Copy your site into that directory
COPY site/ /usr/share/nginx/html/

# Basic healthcheck endpoint (optional but helpful)
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1