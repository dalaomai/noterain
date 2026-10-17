#!/bin/bash

# Variables
DOCKER_REGISTRY="git.donnerdachs.com/s"
APP_IMAGE="noterain"
VERSION="latest"
COMPOSE_FILE="docker-compose.production.yml"

# Pull latest image
echo "Pulling latest noterain image..."
docker pull $DOCKER_REGISTRY/$APP_IMAGE:$VERSION

# Recreate only the application service, avoiding the explicit down/up gap.
# A single-container Compose deployment can still have a brief interruption
# while Docker replaces the container bound to the same host port.
echo "Deploying updated noterain image..."
docker compose -f $COMPOSE_FILE up -d \
	--no-deps \
	--force-recreate \
	--remove-orphans \
	noterain

echo "Waiting for noterain to become healthy..."
CONTAINER_ID=$(docker compose -f $COMPOSE_FILE ps -q noterain)
for attempt in $(seq 1 30); do
	HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_ID")
	if [ "$HEALTH" = "healthy" ]; then
		echo "noterain has been updated and is healthy."
		exit 0
	fi
	if [ "$HEALTH" = "unhealthy" ]; then
		echo "noterain deployment failed: container is unhealthy."
		docker compose -f $COMPOSE_FILE logs --tail=50 noterain
		exit 1
	fi
	sleep 1
done

echo "noterain deployment timed out while waiting for health check."
docker compose -f $COMPOSE_FILE logs --tail=50 noterain
exit 1
