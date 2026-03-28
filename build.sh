#!/bin/bash
set -e

pnpm install

PORT=5000 BASE_PATH=/ pnpm -r --if-present run build
