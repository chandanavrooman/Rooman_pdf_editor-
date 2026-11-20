#!/usr/bin/env bash
# Rooman PDF: install or update on a Debian / Ubuntu server or container. Run as root, on the server.
#
#   bash install-debian.sh --origin http://192.168.1.60
#
# It expects the project (backend/, mcp-server/, frontend/dist/, .env.example) already unpacked in /opt/rooman-pdf
# (deploy-to-container.ps1 does that). Safe to run again: an update keeps your .env, your files and your users.
#
# What it sets up
#   - the programs behind the server tools:  Ghostscript (Compress), LibreOffice (Word/Excel/PowerPoint to PDF),
#     Chromium (HTML to PDF), Tesseract (OCR, Deskew)
#   - the Python backend (127.0.0.1:8000) and the MCP tool server (127.0.0.1:8001) as systemd services
#   - nginx: serves the website and passes /api/ to the backend (port 80)
set -euo pipefail

APP=/opt/rooman-pdf
DATA=/var/lib/rooman-pdf
USER_NAME=rooman
ORIGIN=""
REGISTRATION=true

while [ $# -gt 0 ]; do
  case "$1" in
    --origin) ORIGIN="${2:-}"; shift 2 ;;
    --no-registration) REGISTRATION=false; shift ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run this as root (or with sudo)." >&2; exit 1; }
[ -d "$APP/backend/app" ] || { echo "The project is not in $APP (backend/app is missing)." >&2; exit 1; }
[ -f "$APP/frontend/dist/index.html" ] || { echo "frontend/dist is missing: build the website first (npm run build in frontend/)." >&2; exit 1; }
[ -n "$ORIGIN" ] || ORIGIN="http://$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "==> Website address (CORS origin): $ORIGIN"

export DEBIAN_FRONTEND=noninteractive
echo "==> Installing system packages (this takes a few minutes the first time)"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  python3 python3-venv python3-pip \
  ghostscript \
  libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress default-jre-headless \
  tesseract-ocr tesseract-ocr-eng chromium \
  fonts-liberation fonts-dejavu-core \
  nginx curl ca-certificates openssl >/dev/null

python3 - <<'PY'
import sys
if sys.version_info < (3, 11):
    sys.exit("Python 3.11 or newer is required (Debian 12 or newer).")
PY

echo "==> Service user and folders"
id "$USER_NAME" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$USER_NAME"
mkdir -p "$DATA"
chown -R "$USER_NAME":"$USER_NAME" "$DATA"
chmod 750 "$DATA"

echo "==> Settings file ($APP/.env)"
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  NEW_ENV=1
else
  NEW_ENV=0
fi
gen() { python3 -c 'import secrets; print(secrets.token_urlsafe(48))'; }
setvar() { # setvar KEY VALUE [force]: set KEY unless it already has a value (force = always)
  python3 - "$1" "$2" "${3:-}" "$APP/.env" <<'PY'
import re, sys, pathlib
k, v, force, path = sys.argv[1:5]
p = pathlib.Path(path); s = p.read_text()
m = re.search(rf"^{k}=(.*)$", s, re.M)
if m and m.group(1).strip() and not force:
    sys.exit(0)
line = f"{k}={v}"
p.write_text(re.sub(rf"^{k}=.*$", lambda _: line, s, flags=re.M) if m else s.rstrip("\n") + "\n" + line + "\n")
PY
}
setvar ENV production force
setvar LOCAL_TEST_MODE false force
setvar JWT_SECRET "$(gen)"
setvar MCP_SHARED_SECRET "$(gen)"
setvar STORAGE_DIR "$DATA" force
setvar CORS_ORIGINS "$ORIGIN" force
# HTML to PDF: the browser cannot build its own sandbox inside a service with NoNewPrivileges / a container. The page it draws is
# untrusted, so it is locked down instead (no scripts, no network, no file access: see backend/app/services/convert.py).
setvar CHROMIUM_NO_SANDBOX true force
if [ "$NEW_ENV" = 1 ]; then setvar ALLOW_REGISTRATION "$REGISTRATION" force; fi
chown root:"$USER_NAME" "$APP/.env"
chmod 640 "$APP/.env"

echo "==> Python environment"
if [ ! -x "$APP/backend/.venv/bin/python" ]; then python3 -m venv "$APP/backend/.venv"; fi
"$APP/backend/.venv/bin/pip" install --quiet --upgrade pip
"$APP/backend/.venv/bin/pip" install --quiet -r "$APP/backend/requirements.txt"
chown -R root:"$USER_NAME" "$APP"
chmod -R g+rX,o-rwx "$APP"

echo "==> Services"
cat > /etc/systemd/system/rooman-pdf-backend.service <<EOF
[Unit]
Description=Rooman PDF backend (FastAPI)
After=network.target

[Service]
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$APP/backend
ExecStart=$APP/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/rooman-pdf-mcp.service <<EOF
[Unit]
Description=Rooman PDF MCP tool server (used by the AI assistant)
After=network.target rooman-pdf-backend.service

[Service]
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$APP/mcp-server
ExecStart=$APP/backend/.venv/bin/python -m rooman_pdf_mcp
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF

echo "==> nginx"
cat > /etc/nginx/sites-available/rooman-pdf <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root $APP/frontend/dist;
    index index.html;

    client_max_body_size 60m;          # the backend allows MAX_UPLOAD_MB (50)
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 900s;       # conversions and OCR can take minutes
        proxy_send_timeout 900s;
    }

    # the AI assistant streams its answer: do not buffer it
    location /api/ai/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 900s;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;   # the website is a single-page app
    }
}
EOF
ln -sf /etc/nginx/sites-available/rooman-pdf /etc/nginx/sites-enabled/rooman-pdf
rm -f /etc/nginx/sites-enabled/default
nginx -t

systemctl daemon-reload
systemctl enable --now nginx rooman-pdf-backend rooman-pdf-mcp >/dev/null
systemctl restart rooman-pdf-backend rooman-pdf-mcp
systemctl reload nginx

echo "==> Waiting for the backend"
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/system/capabilities -o /tmp/rooman-caps.json 2>/dev/null; then break; fi
  sleep 1
done
if [ ! -s /tmp/rooman-caps.json ]; then
  echo "The backend did not start. Look at:  journalctl -u rooman-pdf-backend -n 50" >&2
  exit 1
fi

echo
echo "==> Server tools on this machine"
python3 - <<'PY'
import json
c = json.load(open("/tmp/rooman-caps.json"))
for name, v in c["programs"].items():
    print(f"   {v['label']:<12} {'ready' if v['available'] else 'MISSING'}")
for tool, ok in c["tools"].items():
    print(f"   {tool:<28} {'ready' if ok else 'unavailable'}")
print("   AI assistant               " + ("configured" if c.get("ai_configured") else "NOT configured (add AI_API_KEY to /opt/rooman-pdf/.env, then: systemctl restart rooman-pdf-backend)"))
PY
echo
echo "Done. Open:  $ORIGIN"
echo "Logs:        journalctl -u rooman-pdf-backend -f      (backend)"
echo "             journalctl -u rooman-pdf-mcp -f          (AI tool server)"
echo "Settings:    /opt/rooman-pdf/.env"
