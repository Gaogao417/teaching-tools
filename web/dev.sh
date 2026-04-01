#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

ensure_env_file() {
  local target_dir="$1"
  if [[ ! -f "${target_dir}/.env" && -f "${target_dir}/.env.example" ]]; then
    cp "${target_dir}/.env.example" "${target_dir}/.env"
  fi
}

ensure_node_modules() {
  local target_dir="$1"
  local name="$2"
  if [[ ! -d "${target_dir}/node_modules" ]]; then
    echo "[dev] ${name} dependencies are missing."
    echo "[dev] Run: cd ${target_dir} && npm install"
    exit 1
  fi
}

ensure_env_file "${BACKEND_DIR}"
ensure_env_file "${FRONTEND_DIR}"

ensure_node_modules "${BACKEND_DIR}" "backend"
ensure_node_modules "${FRONTEND_DIR}" "frontend"

echo "[dev] Starting backend on http://127.0.0.1:3001"
(
  cd "${BACKEND_DIR}"
  npm run dev
) &
BACKEND_PID=$!

echo "[dev] Starting frontend on http://localhost:5173"
(
  cd "${FRONTEND_DIR}"
  npm run dev
) &
FRONTEND_PID=$!

echo "[dev] App should be available at http://localhost:5173"
echo "[dev] Backend health check: http://127.0.0.1:3001/api/health"
echo "[dev] Press Ctrl+C to stop both processes."

wait "${BACKEND_PID}" "${FRONTEND_PID}"
