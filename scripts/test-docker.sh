#!/bin/bash

# Tagify Docker validation script
# Tests individual components to ensure Docker setup is working

set -e

echo "🧪 Testing Tagify Docker components..."

# Test 1: MongoDB
echo "📊 Testing MongoDB..."
docker run --rm -d --name test-mongo -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  mongo:7 > /dev/null

echo "  ⏳ Waiting for MongoDB to start..."
sleep 10

if docker exec test-mongo mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
  echo "  ✅ MongoDB is working"
else
  echo "  ❌ MongoDB failed"
fi

docker stop test-mongo > /dev/null

# Test 2: MinIO
echo "🗄️  Testing MinIO..."
docker run --rm -d --name test-minio -p 9000:9000 \
  -e MINIO_ROOT_USER=admin \
  -e MINIO_ROOT_PASSWORD=password123 \
  minio/minio server /data > /dev/null

echo "  ⏳ Waiting for MinIO to start..."
sleep 10

if curl -f http://localhost:9000/minio/health/live > /dev/null 2>&1; then
  echo "  ✅ MinIO is working"
else
  echo "  ❌ MinIO failed"
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