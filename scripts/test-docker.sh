#!/bin/bash

# Tagify Docker validation script
# Tests individual components to ensure Docker setup is working

set -e

echo "🧪 Testing Tagify Docker components..."

# Function to cleanup containers
cleanup() {
    echo "🧹 Cleaning up test containers..."
    docker stop test-mongo test-minio 2>/dev/null || true
    docker rm test-mongo test-minio 2>/dev/null || true
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

# Test 1: MongoDB
echo "📊 Testing MongoDB..."
if ! docker run --rm -d --name test-mongo -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  mongo:7 > /dev/null; then
  echo "  ❌ Failed to start MongoDB container"
  exit 1
fi

echo "  ⏳ Waiting for MongoDB to start..."
sleep 15

# Test MongoDB connection with retry
MONGO_READY=false
for i in {1..10}; do
  if docker exec test-mongo mongosh --quiet --eval "db.adminCommand('ping').ok" --authenticationDatabase admin > /dev/null 2>&1; then
    MONGO_READY=true
    break
  fi
  echo "  ⏳ MongoDB not ready yet (attempt $i/10)..."
  sleep 2
done

if [ "$MONGO_READY" = true ]; then
  echo "  ✅ MongoDB is working"
else
  echo "  ❌ MongoDB failed to become ready"
  exit 1
fi

docker stop test-mongo > /dev/null

# Test 2: MinIO
echo "🗄️  Testing MinIO..."
if ! docker run --rm -d --name test-minio -p 9000:9000 \
  -e MINIO_ROOT_USER=admin \
  -e MINIO_ROOT_PASSWORD=password123 \
  minio/minio server /data > /dev/null; then
  echo "  ❌ Failed to start MinIO container"
  exit 1
fi

echo "  ⏳ Waiting for MinIO to start..."
sleep 15

# Test MinIO health with retry
MINIO_READY=false
for i in {1..10}; do
  if curl -f http://localhost:9000/minio/health/live > /dev/null 2>&1; then
    MINIO_READY=true
    break
  fi
  echo "  ⏳ MinIO not ready yet (attempt $i/10)..."
  sleep 2
done

if [ "$MINIO_READY" = true ]; then
  echo "  ✅ MinIO is working"
else
  echo "  ❌ MinIO failed to become ready"
  exit 1
fi

docker stop test-minio > /dev/null

# Test 3: Docker Compose config
echo "🐳 Testing Docker Compose configuration..."
if docker compose -f docker-compose.yml config > /dev/null 2>&1; then
  echo "  ✅ Docker Compose config is valid"
else
  echo "  ❌ Docker Compose config is invalid"
  exit 1
fi

echo ""
echo "🎉 All tests passed! Docker setup appears to be working correctly."
echo ""
echo "To start the full stack:"
echo "  docker compose up --build -d"
echo ""
echo "To check status:"
echo "  docker compose ps"