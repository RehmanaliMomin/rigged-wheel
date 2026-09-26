#!/usr/bin/env bash
# Run Laya on this Mac and put it on the internet through ngrok, so the live
# wheel can use it. Leave this terminal open; Ctrl+C stops both.
#
#   NGROK_DOMAIN=your-name.ngrok-free.app ./server/host-on-mac.sh
#
# Your free permanent ngrok domain is listed at https://dashboard.ngrok.com/domains
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME/.local/share/rigged-wheel-laya"   # outside ~/Desktop, so macOS privacy prompts don't block it
PORT="${PORT:-7860}"

mkdir -p "$HOME_DIR"
cp "$SRC/app.py" "$SRC/requirements.txt" "$HOME_DIR/"
if [ ! -x "$HOME_DIR/.venv/bin/uvicorn" ]; then
  echo "First run: installing Laya (a few minutes)…"
  uv venv -q -p python3.13 "$HOME_DIR/.venv"
  VIRTUAL_ENV="$HOME_DIR/.venv" uv pip install -q -r "$HOME_DIR/requirements.txt"
fi

echo "Starting Laya on 127.0.0.1:$PORT (the first start downloads the ~1.7 GB model)…"
"$HOME_DIR/.venv/bin/uvicorn" --app-dir "$HOME_DIR" app:app --host 127.0.0.1 --port "$PORT" --log-level warning &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
until curl -fs "http://127.0.0.1:$PORT/" >/dev/null; do
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "Laya failed to start." >&2; exit 1; }
  sleep 2
done
echo "Laya is up. Opening the tunnel…"

caffeinate -i ngrok http "$PORT" ${NGROK_DOMAIN:+--url "$NGROK_DOMAIN"}
