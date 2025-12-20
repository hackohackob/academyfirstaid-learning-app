#!/bin/bash
# This script should be run on the server after setup
# It pulls the latest Docker image and restarts the service

set -e

APP_DIR="/opt/academyfirstaid"

echo "=== Deploying Academy First Aid ==="

cd $APP_DIR

echo "Pulling latest Docker image..."
docker-compose pull

echo "Restarting services..."
docker-compose up -d

echo "Cleaning up old images..."
docker system prune -f

echo "=== Deployment Complete ==="
echo "View logs with: docker-compose logs -f"
