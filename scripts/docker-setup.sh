#!/bin/bash

# Quick setup script for Tagify Docker environment

set -e

echo "🚀 Setting up Tagify with Docker Compose..."

# Check if Docker and Docker Compose are available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose is not available. Please install Docker Compose first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "✅ Created .env file. You can customize it if needed."
else
    echo "✅ .env file already exists."
fi

echo ""
echo "🐳 Starting Tagify services with Docker Compose..."
echo "This will start:"
echo "  - Frontend: http://localhost:5173"
echo "  - Backend API: http://localhost:8000"
echo "  - MinIO Console: http://localhost:9001 (admin:password123)"
echo "  - MongoDB: localhost:27017"
echo ""

# Start services
docker compose up --build -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check health of services
echo "🔍 Checking service status..."
docker compose ps

echo ""
echo "🎉 Tagify should now be running!"
echo ""
echo "📍 Access points:"
echo "  Frontend:     http://localhost:5173"
echo "  Backend API:  http://localhost:8000/health"
echo "  MinIO Console: http://localhost:9001"
echo ""
echo "📝 To stop services: docker compose down"
echo "📝 To view logs: docker compose logs -f"