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
LOG_FILE="/var/www/jabar/deploy.log"

# Log to both console and file
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "═══════════════════════════════════════════"
echo "  Deploy: $TARGET"
echo "  Time:   $TIMESTAMP"
echo "═══════════════════════════════════════════"

# ── Paths ──────────────────────────────────────────
REPO_DIR="/var/www/jabar/repos"
BACKEND_REPO="$REPO_DIR/backend"
FRONTEND_REPO="$REPO_DIR/frontend"
BACKEND_LIVE="/var/www/jabar/backend"
FRONTEND_LIVE="/var/www/jabar/frontend/dist"

deploy_backend() {
    echo "→ Deploying backend..."

    echo "  [1/5] git pull..."
    cd "$BACKEND_REPO"
    git checkout -- .
    git clean -fd
    git pull origin main

    echo "  [2/5] copy source to live dir..."
    cp -r src "$BACKEND_LIVE"/
    cp -r prisma "$BACKEND_LIVE"/
    cp package.json "$BACKEND_LIVE"/
    cp package-lock.json "$BACKEND_LIVE"/

    echo "  [3/6] npm install..."
    cd "$BACKEND_LIVE"
    npm install

    echo "  [4/6] prisma generate..."
    npx prisma generate

    echo "  [5/6] prisma migrate deploy..."
    npx prisma migrate deploy

    echo "  [6/6] pm2 restart..."
    pm2 restart jabar-backend --update-env || pm2 start src/server.js --name jabar-backend

    echo "✅ Backend deployed!"
}

deploy_frontend() {
    echo "→ Deploying frontend..."

    echo "  [1/3] git pull..."
    cd "$FRONTEND_REPO"
    git checkout -- .
    git clean -fd
    git pull origin main

    # The frontend repo root IS the Vite app and ships a prebuilt dist/ in every
    # commit, so deploy just publishes that committed build — no npm install/build
    # on the server (avoids the old broken `cd frontend/frontend` path).
    echo "  [2/3] publish committed dist to live dir..."
    rm -rf "$FRONTEND_LIVE"/assets "$FRONTEND_LIVE"/index.html "$FRONTEND_LIVE"/version.json
    cp -r dist/* "$FRONTEND_LIVE"/

    echo "  [3/3] verify version..."
    cat "$FRONTEND_LIVE/version.json"

    echo ""
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
