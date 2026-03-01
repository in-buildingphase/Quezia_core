#!/usr/bin/env bash

# run-ephemeral.sh
# Runs a command and then cleans the database.

# Exit on error
set -e

if [ $# -eq 0 ]; then
    echo "Usage: ./scripts/run-ephemeral.sh <command> [args...]"
    exit 1
fi

echo "🚀 Running command: $@"
"$@"

echo "🧹 Running database cleanup..."
npx ts-node scripts/db-cleanup.ts
