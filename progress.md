# ECS Refactor Progress

## Step 1 — Task 1: Fix destroyEntity listener ordering
Reordered destroyEntity to fire listeners before removing components and marking entity dead, so listeners can access component data for cleanup; added tests for listener component access and change tracking of removals.
