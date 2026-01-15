FROM nginx:alpine

# Copy the site into Nginx web root
COPY site/ /usr/share/nginx/html/

# Nginx config (enables /browse and no-cache tree.json)
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Auto-generate /tree.json at container start
COPY docker-entrypoint.d/10-generate-tree.sh /docker-entrypoint.d/10-generate-tree.sh
RUN chmod +x /docker-entrypoint.d/10-generate-tree.sh

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1