#!/bin/sh
# Writes the runtime config the SPA reads at load. Set API_BASE_URL in Sliplane
# to the API service's public URL, e.g. https://api-xxxx.sliplane.app/api/v1
set -e
: "${API_BASE_URL:=http://localhost:3000/api/v1}"
cat > /usr/share/nginx/html/env.js <<EOF
window.__PORTAL_ENV__ = { API_BASE_URL: "${API_BASE_URL}" };
EOF
echo "portal: wrote /env.js with API_BASE_URL=${API_BASE_URL}"
