FROM nginx:alpine

COPY site/ /usr/share/nginx/html/
COPY program-monitor/ /usr/share/nginx/html/program-monitor/
COPY lan-dashboard/ /usr/share/nginx/html/lan-dashboard/
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copy the entrypoint script
COPY docker-entrypoint.d/10-generate-tree.sh /docker-entrypoint.d/10-generate-tree.sh

# CRITICAL: strip Windows CRLF and make executable
RUN sed -i 's/\r$//' /docker-entrypoint.d/10-generate-tree.sh && \
    chmod +x /docker-entrypoint.d/10-generate-tree.sh

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD sh -c 'if command -v wget >/dev/null 2>&1; then wget -q -T 2 -O /dev/null http://127.0.0.1/; elif command -v curl >/dev/null 2>&1; then curl -fsS --max-time 2 http://127.0.0.1/ >/dev/null; else nc -z 127.0.0.1 80; fi' || exit 1
