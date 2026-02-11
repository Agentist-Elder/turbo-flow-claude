#!/bin/bash
echo "🚀 Initializing RuvBot Swarm Environment..."
# Ensure the background daemon is alive for the agents
npx @claude-flow/cli@latest start --daemon
# Launch the learning mission to observe agent behavior
npx @claude-flow/cli@latest swarm learning-mission.txt
