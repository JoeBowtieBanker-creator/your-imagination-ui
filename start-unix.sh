#!/usr/bin/env bash
# ---- Imagine launcher (macOS / Linux) ----
# Starts ComfyUI in the background if needed, then opens only Imagine.
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 not found. Install Python 3.10+ and re-run."
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi
source .venv/bin/activate

echo "Installing dependencies (first run only)..."
pip install -q -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
STARTED_COMFY=0

if [ -d "$(dirname "$0")/../../ComfyUI_windows_portable/ComfyUI/models" ]; then
  export COMFY_MODELS="$(cd "$(dirname "$0")/../../ComfyUI_windows_portable/ComfyUI/models" && pwd)"
fi

comfy_up() {
  curl -sf -o /dev/null -m 2 "$COMFY_URL/system_stats" >/dev/null 2>&1
}

if comfy_up; then
  echo "ComfyUI is already running."
else
  for candidate in \
    "$(dirname "$0")/../../ComfyUI_windows_portable" \
    "$HOME/ComfyUI" \
    "./ComfyUI"
  do
    if [ -f "$candidate/main.py" ]; then
      COMFY_PY="$candidate/main.py"
      COMFY_DIR="$candidate"
      break
    fi
    if [ -f "$candidate/ComfyUI/main.py" ]; then
      COMFY_PY="$candidate/ComfyUI/main.py"
      COMFY_DIR="$candidate"
      break
    fi
  done
  if [ -n "$COMFY_PY" ]; then
    echo "Starting ComfyUI in the background..."
    MEDIA_HUB="${YI_MEDIA_HUB:-}"
    EXTRA=()
    if [ -n "$MEDIA_HUB" ]; then
      EXTRA+=(--input-directory "$MEDIA_HUB/input" --output-directory "$MEDIA_HUB/output")
    fi
    ( cd "$COMFY_DIR" && python3 "$COMFY_PY" --disable-auto-launch --listen 127.0.0.1 --port 8188 "${EXTRA[@]}" ) >/tmp/imagine-comfy.log 2>&1 &
    COMFY_PID=$!
    STARTED_COMFY=1
    echo "Waiting for ComfyUI at $COMFY_URL ..."
    n=0
    until comfy_up; do
      n=$((n+1))
      if [ "$n" -ge 90 ]; then
        echo "ComfyUI is still loading. Imagine will open anyway."
        break
      fi
      echo "  still starting... ($n)"
      sleep 2
    done
  else
    echo "Could not find ComfyUI. Imagine will still open."
    echo "In Settings, set the ComfyUI folder or install it, then Connect."
  fi
fi

echo "Starting Imagine at http://127.0.0.1:7860"
( sleep 2; (command -v open >/dev/null && open http://127.0.0.1:7860) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:7860) ) &
python3 backend/server.py

if [ "$STARTED_COMFY" = "1" ] && [ -n "$COMFY_PID" ]; then
  echo "Stopping the ComfyUI we started..."
  kill "$COMFY_PID" >/dev/null 2>&1 || true
fi
