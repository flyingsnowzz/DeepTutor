#!/usr/bin/env bash
#
# DeepTutor 一键启动脚本：按需启动后端与前端。
#
#   ./start.sh                显示帮助
#   ./start.sh backend        仅后端 API (deeptutor serve)
#   ./start.sh web            仅 web 前端 (Next.js)
#   ./start.sh vue3           仅 web-vue3 前端 (Vite)
#   ./start.sh frontend       两个前端
#   ./start.sh all            后端 + 两个前端
#   ./start.sh backend web    任意组合
#
# 启动前会自动处理环境与端口：
#   - 缺少虚拟环境 / 依赖时自动创建并安装
#   - 目标端口被占用时先关闭占用进程再启动
#
# 按 Ctrl+C 可一并停止本次启动的所有进程。
#
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

# ---------- 配置 ----------
BACKEND_HOST="${DEEPTUTOR_HOST:-0.0.0.0}"
BACKEND_PORT="${DEEPTUTOR_PORT:-8001}"
# 前端端口在各项目 package.json 中固定：web -> 3782, web-vue3 -> 3783
WEB_PORT=3782
VUE3_PORT=3783

VENV_DIR="$PROJECT_DIR/.venv"
PYTHON="$VENV_DIR/bin/python"
WEB_DIR="$PROJECT_DIR/web"
VUE3_DIR="$PROJECT_DIR/web-vue3"

# ---------- 颜色 ----------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi

# ---------- 帮助 ----------
usage() {
  cat <<EOF
${BOLD}DeepTutor 启动脚本${RESET}

用法: ./start.sh <目标> [目标...]

目标:
  backend     后端 API 服务 (deeptutor serve)    http://localhost:${BACKEND_PORT}
  web         web 前端 (Next.js)                 http://localhost:${WEB_PORT}
  vue3        web-vue3 前端 (Vite)               http://127.0.0.1:${VUE3_PORT}
  frontend    = web + vue3
  all         = backend + web + vue3

示例:
  ./start.sh all             启动后端和全部前端
  ./start.sh backend web     只启动后端与 web
  ./start.sh frontend        只启动两个前端

环境变量:
  DEEPTUTOR_HOST   后端绑定地址 (默认 ${BACKEND_HOST})
  DEEPTUTOR_PORT   后端端口     (默认 ${BACKEND_PORT})

前端端口由各项目 package.json 固定:
  web   -> ${WEB_PORT}  (web/package.json)
  vue3  -> ${VUE3_PORT} (web-vue3/package.json)

启动前会自动：
  - 缺少虚拟环境 / 依赖时创建并安装
  - 关闭占用目标端口的进程

按 Ctrl+C 可一并停止本次启动的所有进程。
EOF
}

# ---------- 参数解析 ----------
REQ_BACKEND=0
REQ_WEB=0
REQ_VUE3=0

for arg in "$@"; do
  case "$arg" in
    backend|api)     REQ_BACKEND=1 ;;
    web|next)        REQ_WEB=1 ;;
    vue3|vite)       REQ_VUE3=1 ;;
    frontend)        REQ_WEB=1; REQ_VUE3=1 ;;
    all)             REQ_BACKEND=1; REQ_WEB=1; REQ_VUE3=1 ;;
    -h|--help|help)  usage; exit 0 ;;
    *)
      echo "${RED}未知目标: $arg${RESET}" >&2
      echo
      usage
      exit 1
      ;;
  esac
done

# 无参数时默认展示帮助
if [ $((REQ_BACKEND + REQ_WEB + REQ_VUE3)) -eq 0 ]; then
  usage
  exit 0
fi

# ---------- 工具函数 ----------
fail() { echo "${RED}错误: $1${RESET}" >&2; exit 1; }

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

list_port_pids() { lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null; }

# 释放端口：先 TERM，超时后 KILL
free_port() {
  local port="$1" name="$2" pid
  port_in_use "$port" || return 0

  echo "${YELLOW}端口 $port 已被占用，正在关闭占用进程 ($name) ...${RESET}"
  for pid in $(list_port_pids "$port"); do
    echo "  ${DIM}停止 PID $pid  $(ps -p "$pid" -o comm= 2>/dev/null)${RESET}"
    kill "$pid" 2>/dev/null || true
  done

  for _ in 1 2 3 4 5; do
    port_in_use "$port" || break
    sleep 1
  done

  if port_in_use "$port"; then
    echo "${YELLOW}  进程未退出，强制结束 ...${RESET}"
    for pid in $(list_port_pids "$port"); do
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 1
  fi

  port_in_use "$port" && fail "无法释放端口 $port"
  echo "${GREEN}端口 $port 已释放${RESET}"
}

# ---------- 环境准备 ----------
prepare_backend() {
  if [ ! -x "$PYTHON" ]; then
    echo "${YELLOW}▶ 未找到虚拟环境，创建 $VENV_DIR ...${RESET}"
    if command -v uv >/dev/null 2>&1; then
      uv venv "$VENV_DIR" || fail "创建虚拟环境失败"
    else
      python3 -m venv "$VENV_DIR" || fail "创建虚拟环境失败"
    fi
  fi

  if ! "$PYTHON" -c 'import deeptutor_cli.main' >/dev/null 2>&1; then
    echo "${YELLOW}▶ 后端依赖缺失，开始安装 ...${RESET}"
    if command -v uv >/dev/null 2>&1; then
      uv pip install --python "$PYTHON" -r "$PROJECT_DIR/requirements/full.txt" || fail "安装依赖失败"
      uv pip install --python "$PYTHON" -e "$PROJECT_DIR" --no-deps || fail "安装项目失败"
    else
      "$PYTHON" -m pip install -r "$PROJECT_DIR/requirements/full.txt" || fail "安装依赖失败"
      "$PYTHON" -m pip install -e "$PROJECT_DIR" --no-deps || fail "安装项目失败"
    fi
    echo "${GREEN}后端环境就绪${RESET}"
  fi
}

prepare_frontend() {
  local dir="$1" name="$2"
  [ -d "$dir" ] || fail "目录不存在: $dir"
  if [ ! -d "$dir/node_modules" ]; then
    echo "${YELLOW}▶ $name 依赖缺失，开始安装 ...${RESET}"
    ( cd "$dir" && npm install --legacy-peer-deps ) || fail "$name 依赖安装失败"
    echo "${GREEN}$name 依赖就绪${RESET}"
  fi
}

# ---------- 环境预览 ----------
echo
echo "${BOLD}DeepTutor 启动器${RESET}  ${DIM}${PROJECT_DIR}${RESET}"
echo
echo "${BOLD}计划启动:${RESET}"
[ "$REQ_BACKEND" = 1 ] && echo "  ${GREEN}backend${RESET}  -> http://localhost:${BACKEND_PORT}"
[ "$REQ_WEB" = 1 ]     && echo "  ${GREEN}web${RESET}      -> http://localhost:${WEB_PORT}"
[ "$REQ_VUE3" = 1 ]    && echo "  ${GREEN}vue3${RESET}     -> http://127.0.0.1:${VUE3_PORT}"
echo

# ---------- 准备环境 ----------
[ "$REQ_BACKEND" = 1 ] && prepare_backend
[ "$REQ_WEB" = 1 ]     && prepare_frontend "$WEB_DIR" "web"
[ "$REQ_VUE3" = 1 ]    && prepare_frontend "$VUE3_DIR" "web-vue3"

echo "${DIM}Python $("$PYTHON" --version 2>/dev/null | awk '{print $2}' || echo '-')   Node $(node --version 2>/dev/null || echo '-')${RESET}"
echo

# ---------- 释放端口 ----------
[ "$REQ_BACKEND" = 1 ] && free_port "$BACKEND_PORT" "backend"
[ "$REQ_WEB" = 1 ]     && free_port "$WEB_PORT" "web"
[ "$REQ_VUE3" = 1 ]    && free_port "$VUE3_PORT" "vue3"
echo

# ---------- 进程管理 ----------
declare -a PIDS=()

cleanup() {
  trap - INT TERM
  echo
  echo "${YELLOW}正在停止所有进程...${RESET}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  echo "${GREEN}已停止。${RESET}"
}
trap cleanup INT TERM

start_backend() {
  echo "${CYAN}▶ 启动 backend ...${RESET}"
  "$PYTHON" -m deeptutor_cli.main serve --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
  PIDS+=("$!")
}

start_web() {
  echo "${CYAN}▶ 启动 web (Next.js) ...${RESET}"
  ( cd "$WEB_DIR" && exec npm run dev ) &
  PIDS+=("$!")
}

start_vue3() {
  echo "${CYAN}▶ 启动 web-vue3 (Vite) ...${RESET}"
  ( cd "$VUE3_DIR" && exec npm run dev ) &
  PIDS+=("$!")
}

# ---------- 启动 ----------
[ "$REQ_BACKEND" = 1 ] && start_backend

# 后端与前端同时启动时，稍等后端监听端口，避免前端首连失败
if [ "$REQ_BACKEND" = 1 ] && [ $((REQ_WEB + REQ_VUE3)) -gt 0 ]; then
  sleep 2
fi

[ "$REQ_WEB" = 1 ] && start_web
[ "$REQ_VUE3" = 1 ] && start_vue3

echo
echo "${GREEN}已全部启动。按 Ctrl+C 停止。${RESET}"
wait
