#!/bin/bash

# Tagify Docker smoke test: builds the CI stack, indexes ./test_images, and
# checks the API + media endpoints. Mirrors .github/workflows/ci.yml.

set -euo pipefail

# Override the host port to run alongside a dev backend on :8000.
export TAGIFY_BACKEND_PORT="${TAGIFY_BACKEND_PORT:-8000}"
BASE="http://localhost:${TAGIFY_BACKEND_PORT}"
COMPOSE="docker compose -f docker-compose.ci.yml"
API="$BASE/api/v1"

cleanup() {
    echo "🧹 Tearing down CI stack..."
    $COMPOSE down -v > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "🐳 Building and starting the CI stack..."
$COMPOSE up --build -d

echo "⏳ Waiting for backend health..."
for i in {1..60}; do
    if curl -sf "$BASE/health" > /dev/null; then break; fi
    if [ "$i" = 60 ]; then echo "❌ Backend never became healthy"; $COMPOSE logs backend; exit 1; fi
    sleep 2
done
echo "  ✅ Backend healthy"

echo "📚 Adding /data/test_images as a library..."
LIB_ID=$(curl -sf -X POST -H 'Content-Type: application/json' \
    -d '{"path":"/data/test_images","name":"docker-test"}' "$API/libraries" | jq -r '._id')

for i in {1..120}; do
    SCANNING=$(curl -sf "$API/libraries/$LIB_ID/progress" | jq -r '.scanning')
    [ "$SCANNING" = "false" ] && break
    sleep 2
done
INDEXED=$(curl -sf "$API/libraries/$LIB_ID/progress" | jq -r '.indexed_count')
if [ "$INDEXED" = "0" ]; then echo "❌ Nothing indexed"; $COMPOSE logs backend; exit 1; fi
echo "  ✅ Indexed $INDEXED images"

IMG_ID=$(curl -sf "$API/images?limit=1&library_id=$LIB_ID" | jq -r '.[0]._id')
curl -sf -o /dev/null "$API/images/$IMG_ID/thumb" && echo "  ✅ Thumbnail served"
curl -sf -o /dev/null "$API/images/$IMG_ID/file" && echo "  ✅ Original served"

echo "🎉 Docker smoke test passed"
