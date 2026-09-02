"""Start, adopt, and stop the ComfyUI process owned by Your Imagination."""

from __future__ import annotations

import os
import subprocess
import sys
import time

import appconfig

CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_CONSOLE = 0x00000010

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = "8188"


def _no_window() -> int:
    return CREATE_NO_WINDOW if os.name == "nt" else 0


def _taskkill(pid: int) -> None:
    if pid <= 0:
        return
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        capture_output=True,
        creationflags=_no_window(),
    )


def _alive(pid: int) -> bool:
    if pid <= 0:
        return False
    r = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
        capture_output=True,
        text=True,
        creationflags=_no_window(),
    )
    return str(pid) in (r.stdout or "")


def _parent_pid(pid: int) -> int:
    if pid <= 0:
        return 0
    r = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f"(Get-CimInstance Win32_Process -Filter 'ProcessId={int(pid)}').ParentProcessId",
        ],
        capture_output=True,
        text=True,
        creationflags=_no_window(),
    )
    text = (r.stdout or "").strip().split()[-1] if (r.stdout or "").strip() else ""
    return int(text) if text.isdigit() else 0


def launcher_pid() -> int:
    """PID of the cmd.exe running start-windows.bat (direct parent of this python)."""
    print(os.getppid())
    return 0


def _pid_listening(port: int) -> int:
    r = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True,
        text=True,
        creationflags=_no_window(),
    )
    for line in (r.stdout or "").splitlines():
        if "LISTENING" not in line.upper():
            continue
        if f":{int(port)}" not in line:
            continue
        if not any(s in line for s in (f"127.0.0.1:{port}", f"0.0.0.0:{port}", f"[::]:{port}", f"[::1]:{port}")):
            continue
        tail = line.split()[-1]
        if tail.isdigit():
            return int(tail)
    return 0


def _cmd_line(pid: int) -> str:
    r = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f"(Get-CimInstance Win32_Process -Filter 'ProcessId={int(pid)}').CommandLine",
        ],
        capture_output=True,
        text=True,
        creationflags=_no_window(),
    )
    return r.stdout or ""


def free_ui_port(port: int = 7860) -> int:
    """Kill a leftover Your Imagination Flask on this port so the launcher can bind."""
    pid = _pid_listening(port)
    if not pid:
        print("0")
        return 0
    cmd = _cmd_line(pid).lower()
    ours = "server.py" in cmd or "yourimagination" in cmd.replace(" ", "") or "your imagination" in cmd
    if not ours:
        parent = _parent_pid(pid)
        cmd = (_cmd_line(parent) + " " + cmd).lower()
        ours = "server.py" in cmd or "yourimagination" in cmd.replace(" ", "")
        if ours:
            pid = parent or pid
    if ours:
        parent = _parent_pid(pid)
        if parent and "server.py" in _cmd_line(parent).lower():
            _taskkill(parent)
            _taskkill(pid)
        else:
            _taskkill(pid)
        time.sleep(0.4)
        print(pid)
        return 0
    print("0")
    return 0


def _wmi_ours(comfy_root: str) -> int:
    exe = _python_exe(comfy_root).replace("'", "''")
    r = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "$exe = [string]'" + exe + "'; "
            "Get-CimInstance Win32_Process | Where-Object { "
            "  $_.ExecutablePath -and "
            "  ([string]$_.ExecutablePath).Equals($exe, [StringComparison]::OrdinalIgnoreCase) -and "
            "  $_.CommandLine -and "
            "  ($_.CommandLine -like '*ComfyUI\\main.py*' -or $_.CommandLine -like '*ComfyUI/main.py*') -and "
            "  $_.CommandLine -like '*--disable-auto-launch*' -and "
            "  $_.CommandLine -like '*--port 8188*' "
            "} | Select-Object -First 1 -ExpandProperty ProcessId",
        ],
        capture_output=True,
        text=True,
        creationflags=_no_window(),
    )
    text = (r.stdout or "").strip()
    if text.isdigit():
        return int(text)
    return 0


def _root(comfy_root: str) -> str:
    return os.path.normpath(os.path.abspath(comfy_root))


def _python_exe(comfy_root: str) -> str:
    return os.path.join(_root(comfy_root), "python_embeded", "python.exe")


def find_ours(comfy_root: str) -> int:
    return _wmi_ours(_root(comfy_root))


def start(comfy_root: str) -> int:
    comfy_root = _root(comfy_root)
    existing = find_ours(comfy_root)
    if existing:
        print(existing)
        return 0

    exe = _python_exe(comfy_root)
    if not os.path.isfile(exe):
        print("0")
        return 1

    hub = None
    extra = []
    if appconfig.media_hub_configured():
        try:
            hub = appconfig.assert_media_hub_drive()
        except FileNotFoundError as e:
            print(str(e), file=sys.stderr)
            print("0")
            return 1
        hub_in = appconfig.media_hub_input()
        hub_out = appconfig.media_hub_output()
        os.makedirs(hub_in, exist_ok=True)
        os.makedirs(hub_out, exist_ok=True)
        extra = ["--input-directory", hub_in, "--output-directory", hub_out]

    # Launch python.exe itself so cmd does not re-parse paths with spaces.
    # New console keeps the traceback visible if PyTorch/Smart App Control fails.
    creation = CREATE_NEW_CONSOLE if os.name == "nt" else 0
    proc = subprocess.Popen(
        [
            exe,
            "-s",
            "ComfyUI\\main.py",
            "--windows-standalone-build",
            "--fast",
            "fp16_accumulation",
            "--lowvram",
            "--preview-method",
            "auto",
            "--disable-auto-launch",
            "--listen",
            "127.0.0.1",
            "--port",
            "8188",
        ] + extra,
        cwd=comfy_root,
        creationflags=creation,
    )
    if hub:
        print("Media hub " + hub, file=sys.stderr)
    print(proc.pid)
    return 0


def stop(comfy_root: str, pid: int = 0) -> int:
    comfy_root = _root(comfy_root)
    if pid:
        _taskkill(pid)
    leftover = find_ours(comfy_root)
    if leftover:
        _taskkill(leftover)
    # Last resort: the visible wrapper window from this launcher.
    for title in ("ComfyUI-Imagine*", "ComfyUI-Imagine*"):
        subprocess.run(
            ["taskkill", "/FI", f"WINDOWTITLE eq {title}", "/T", "/F"],
            capture_output=True,
            creationflags=_no_window(),
        )
    return 0


def resolve_comfy_root(path: str) -> str:
    """Accept portable root, ComfyUI folder, or models folder."""
    raw = os.path.abspath(os.path.expanduser(str(path or "").strip().strip('"')))
    if not raw or not os.path.isdir(raw):
        return ""
    checks = [raw]
    name = os.path.basename(raw).lower()
    if name == "models":
        checks.append(os.path.dirname(raw))
        checks.append(os.path.dirname(os.path.dirname(raw)))
    if name == "comfyui":
        checks.append(os.path.dirname(raw))
    for cand in checks:
        if os.path.isfile(os.path.join(cand, "python_embeded", "python.exe")):
            return os.path.normpath(os.path.abspath(cand))
        if os.path.isfile(os.path.join(cand, "main.py")):
            return os.path.normpath(os.path.abspath(cand))
        inner = os.path.join(cand, "ComfyUI")
        if os.path.isfile(os.path.join(inner, "main.py")) and os.path.isfile(
            os.path.join(cand, "python_embeded", "python.exe")
        ):
            return os.path.normpath(os.path.abspath(cand))
        if os.path.isfile(os.path.join(inner, "main.py")):
            return os.path.normpath(os.path.abspath(inner))
    return ""


def portable_ok(comfy_root: str) -> bool:
    return bool(comfy_root) and os.path.isfile(_python_exe(comfy_root))


def inspect(comfy_root: str = "") -> dict:
    """Describe whether ComfyUI is installed / launchable from this path."""
    raw = (comfy_root or "").strip()
    resolved = resolve_comfy_root(raw) if raw else ""
    root = resolved or (guess_comfy_root("") if not raw else "")
    has_portable = portable_ok(root)
    has_main = bool(root) and (
        os.path.isfile(os.path.join(root, "main.py"))
        or os.path.isfile(os.path.join(root, "ComfyUI", "main.py"))
    )
    installed = has_portable or has_main
    if not root:
        status = "not_installed"
        label = "Not installed — no ComfyUI folder found."
    elif has_portable:
        status = "found"
        label = "Found Windows portable at this path."
    elif has_main:
        status = "found"
        label = "Found ComfyUI at this path (start it yourself, then Connect)."
    else:
        status = "invalid"
        label = "That folder exists but is not a ComfyUI install."
    return {
        "root": root or "",
        "hint": raw,
        "installed": installed,
        "portable": has_portable,
        "can_start": has_portable,
        "status": status,
        "label": label,
    }


def guess_comfy_root(hint: str = "") -> str:
    found = []
    saved = ""
    try:
        saved = (appconfig.load().get("comfy_root") or "").strip()
    except Exception:
        saved = ""
    for raw in (hint, saved, os.environ.get("COMFY_ROOT") or ""):
        raw = (raw or "").strip()
        if not raw or raw in (".", "-"):
            continue
        resolved = resolve_comfy_root(raw)
        found.append(resolved or os.path.abspath(raw))
    try:
        import packs
        models = packs.detect_models_root()
        if models:
            p = os.path.abspath(models)
            for _ in range(5):
                p = os.path.dirname(p)
                if os.path.isfile(os.path.join(p, "python_embeded", "python.exe")):
                    found.append(p)
                    break
    except Exception:
        pass
    sibling = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ComfyUI_windows_portable"))
    found.append(sibling)
    for cand in found:
        if cand and os.path.isfile(os.path.join(cand, "python_embeded", "python.exe")):
            return cand
    return found[0] if found else ""


def _kill_window(title: str) -> None:
    if os.name != "nt":
        return
    subprocess.run(
        ["taskkill", "/F", "/T", "/FI", f"WINDOWTITLE eq {title}"],
        capture_output=True,
        creationflags=_no_window(),
    )


def shutdown_all(comfy_root: str = "", ui_port: int = 7860) -> int:
    """Stop ComfyUI and this app, then close both console windows."""
    time.sleep(0.45)
    root = guess_comfy_root(comfy_root)
    if root:
        stop(root, 0)
    pid_comfy = _pid_listening(8188)
    if pid_comfy:
        cmd = _cmd_line(pid_comfy).lower()
        if "comfyui" in cmd.replace(" ", "") or "main.py" in cmd:
            _taskkill(pid_comfy)
    free_ui_port(ui_port)
    leftover = _pid_listening(ui_port)
    if leftover:
        _taskkill(leftover)
    for title in ("Your Imagination*", "yi-comfy-watch*", "ComfyUI-Imagine*"):
        _kill_window(title)
    return 0


def watch(launcher_pid: int, comfy_pid: int, comfy_root: str) -> int:
    # If the PID was the short-lived for /f cmd, it is already dead. Do not
    # treat that as "user closed Imagine" or we kill Comfy during startup.
    seen = False
    for _ in range(15):
        if _alive(launcher_pid):
            seen = True
            break
        time.sleep(0.2)
    if not seen:
        return 0
    while _alive(launcher_pid):
        time.sleep(0.8)
    stop(comfy_root, comfy_pid)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        return 2
    cmd = argv[1]
    if cmd in ("start", "launch"):
        return start(argv[2])
    if cmd == "stop":
        root = argv[2]
        pid = int(argv[3]) if len(argv) > 3 and argv[3].isdigit() else 0
        return stop(root, pid)
    if cmd == "watch":
        return watch(int(argv[2]), int(argv[3]), argv[4])
    if cmd == "pid":
        print(find_ours(argv[2]) or 0)
        return 0
    if cmd == "launcher-pid":
        return launcher_pid()
    if cmd == "free-ui":
        port = int(argv[2]) if len(argv) > 2 and argv[2].isdigit() else 7860
        return free_ui_port(port)
    if cmd in ("shutdown-all", "shutdown_all"):
        root = argv[2] if len(argv) > 2 else ""
        port = int(argv[3]) if len(argv) > 3 and argv[3].isdigit() else 7860
        return shutdown_all(root, port)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
