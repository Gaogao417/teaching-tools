#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PID=""
FRONTEND_PID=""
AUTO_INSTALL="${AUTO_INSTALL:-1}"
SHUTTING_DOWN=0
STARTED_PID=""

terminate_process_tree() {
  local pid="$1"
  if [[ -z "${pid}" ]] || ! kill -0 "${pid}" 2>/dev/null; then
    return
  fi

  if command -v pgrep >/dev/null 2>&1; then
    local child_pid
    while IFS= read -r child_pid; do
      terminate_process_tree "${child_pid}"
    done < <(pgrep -P "${pid}" || true)
  fi

  kill "${pid}" 2>/dev/null || true
}

cleanup() {
  if [[ "${SHUTTING_DOWN}" == "1" ]]; then
    return
  fi

  SHUTTING_DOWN=1

  terminate_process_tree "${BACKEND_PID}"
  terminate_process_tree "${FRONTEND_PID}"

  wait "${BACKEND_PID}" 2>/dev/null || true
  wait "${FRONTEND_PID}" 2>/dev/null || true
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
    if [[ "${AUTO_INSTALL}" == "1" ]]; then
      echo "[dev] Installing ${name} dependencies..."
      (
        cd "${target_dir}"
        npm install
      )
      return
    fi
    echo "[dev] ${name} dependencies are missing."
    echo "[dev] Run: cd ${target_dir} && npm install"
    echo "[dev] Or rerun with AUTO_INSTALL=1 ./dev.sh"
    exit 1
  fi
}

warn_if_port_in_use() {
  local port="$1"
  local name="$2"

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local listeners
  listeners="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${listeners}" ]]; then
    echo "[dev] Port ${port} is already in use before starting ${name}:"
    echo "${listeners}"
  fi
}

start_service() {
  local name="$1"
  local target_dir="$2"
  local url="$3"

  echo "[dev] Starting ${name} on ${url}"
  (
    cd "${target_dir}"
    exec npm run dev
  ) &
  STARTED_PID="$!"
}

wait_for_service_exit() {
  local exit_code

  while true; do
    if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
      wait "${BACKEND_PID}" 2>/dev/null
      exit_code=$?
      return "${exit_code}"
    fi

    if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
      wait "${FRONTEND_PID}" 2>/dev/null
      exit_code=$?
      return "${exit_code}"
    fi

    sleep 1
  done
}

ensure_env_file "${BACKEND_DIR}"
ensure_env_file "${FRONTEND_DIR}"

ensure_node_modules "${BACKEND_DIR}" "backend"
ensure_node_modules "${FRONTEND_DIR}" "frontend"

warn_if_port_in_use 3001 "backend"
warn_if_port_in_use 5173 "frontend"

start_service "backend" "${BACKEND_DIR}" "http://127.0.0.1:3001"
BACKEND_PID="${STARTED_PID}"
start_service "frontend" "${FRONTEND_DIR}" "http://localhost:5173"
FRONTEND_PID="${STARTED_PID}"

echo "[dev] App should be available at http://localhost:5173"
echo "[dev] Backend health check: http://127.0.0.1:3001/api/health"
echo "[dev] Press Ctrl+C to stop both processes."

set +e
wait_for_service_exit
EXIT_CODE=$?
set -e

cleanup
exit "${EXIT_CODE}"
