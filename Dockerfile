FROM nginx:alpine

COPY site/ /usr/share/nginx/html/
COPY program-monitor/ /usr/share/nginx/html/program-monitor/
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copy the entrypoint script
COPY docker-entrypoint.d/10-generate-tree.sh /docker-entrypoint.d/10-generate-tree.sh

# CRITICAL: strip Windows CRLF and make executable
RUN sed -i 's/\r$//' /docker-entrypoint.d/10-generate-tree.sh && \
    chmod +x /docker-entrypoint.d/10-generate-tree.sh

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
