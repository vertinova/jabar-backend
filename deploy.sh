#!/bin/bash
# ───────────────────────────────────────────────────
# FORBASI Jabar Auto-Deploy Script
# Called by webhook.js when GitHub push event is received
#
# Usage: bash deploy.sh [backend|frontend]
# ───────────────────────────────────────────────────

set -e

TARGET="${1:-backend}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "═══════════════════════════════════════════"
echo "  Deploy: $TARGET"
echo "  Time:   $TIMESTAMP"
echo "═══════════════════════════════════════════"

# ── Paths (adjust to your VPS layout) ─────────────
BACKEND_DIR="/var/www/forbasi-jabar-backend"
FRONTEND_DIR="/var/www/forbasi-jabar-frontend"
FRONTEND_SRC_DIR="/var/www/forbasi-jabar-frontend-src"   # where the git repo lives for frontend

deploy_backend() {
    echo "→ Deploying backend..."
    cd "$BACKEND_DIR"

    echo "  [1/4] git pull..."
    git pull origin main

    echo "  [2/4] npm install..."
    npm install --production

    echo "  [3/4] prisma generate..."
    npx prisma generate

    echo "  [4/4] pm2 restart..."
    pm2 restart jabar-backend --update-env || pm2 start src/server.js --name jabar-backend

    echo "✅ Backend deployed!"
}

deploy_frontend() {
    echo "→ Deploying frontend..."
    cd "$FRONTEND_SRC_DIR"

    echo "  [1/4] git pull..."
    git pull origin main

    echo "  [2/4] npm install..."
    npm install

    echo "  [3/4] npm run build..."
    npm run build

    echo "  [4/4] copy build to serve dir..."
    rm -rf "$FRONTEND_DIR"/*
    cp -r dist/* "$FRONTEND_DIR"/

    echo "✅ Frontend deployed!"
}

# ── Run ────────────────────────────────────────────

case "$TARGET" in
    backend)
        deploy_backend
        ;;
    frontend)
        deploy_frontend
        ;;
    *)
        echo "❌ Unknown target: $TARGET"
        echo "Usage: bash deploy.sh [backend|frontend]"
        exit 1
        ;;
esac

echo ""
echo "Deploy finished at $(date '+%Y-%m-%d %H:%M:%S')"
