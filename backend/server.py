"""
server.py — Your Imagination backend.

Serves the local UI, scans model packs, rewrites prompts, builds ComfyUI
graphs, and proxies progress/media so the browser never talks to ComfyUI
directly.
"""

import base64
import json
import mimetypes
import os
import queue
import subprocess
import sys
import threading
import time

import requests
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_sock import Sock
from werkzeug.serving import make_server
import websocket as wsclient

import appconfig
import comfy_ctl
import downloads
import film
import graphs
import library
import llm
import lora_compat
import packs
import recipes
import stories

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(HERE, "..", "frontend")

app = Flask(__name__, static_folder=None)
sock = Sock(app)

_httpd = None
_restarting = False
_progress_lock = threading.Lock()
_progress = {
    "prompt_id": None,
    "value": 0,
    "max": 0,
    "pct": 0,
    "node": None,
    "note": "",
    "ts": 0,
    "client_id": None,
    "pump": "queue-watch",
}
_watcher_started = False
_watch_client_id = None
_watch_sock_sid = None
_watch_kick = threading.Event()
_watch_connected = threading.Event()
_ws_subscribers = []
_discover_cache = (0, None, None)
_RESTART_EXIT = 75
_RESTART_MARK = "yi-flask-restart"


def _reset_progress(prompt_id=None, client_id=None):
    global _watch_client_id
    with _progress_lock:
        if client_id:
            _watch_client_id = client_id
        _progress.update({
            "prompt_id": prompt_id,
            "value": 0,
            "max": 0,
            "pct": 0,
            "node": None,
            "note": "",
            "ts": time.time(),
            "client_id": client_id or _watch_client_id,
            "pump": "queue-watch",
        })
    _watch_kick.set()


def _adopt_watch_client(client_id, prompt_id=None):
    global _watch_client_id
    if not client_id and not prompt_id:
        return
    changed = False
    with _progress_lock:
        if client_id and client_id != _watch_client_id:
            _watch_client_id = client_id
            _progress["client_id"] = client_id
            changed = True
        elif client_id:
            _progress["client_id"] = client_id
        if prompt_id and not _progress.get("prompt_id"):
            _progress["prompt_id"] = prompt_id
            _progress["ts"] = time.time()
    if changed:
        _watch_kick.set()


def _mark_watch_connected(sid):
    global _watch_sock_sid
    with _progress_lock:
        _watch_sock_sid = sid
    if sid:
        _watch_connected.set()
    else:
        _watch_connected.clear()


def _wait_watch_connected(client_id, timeout=2.0):
    if not client_id:
        return False
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _progress_lock:
            if _watch_sock_sid == client_id:
                return True
        _watch_kick.set()
        _watch_connected.wait(0.15)
    return False


def _is_ws_idle_timeout(exc):
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return "timeout" in name or "timed out" in msg or "timedout" in msg


def _discover_running_job(force=False):
    global _discover_cache
    now = time.time()
    if not force and now - _discover_cache[0] < 0.4:
        return _discover_cache[1], _discover_cache[2]
    try:
        q = requests.get(appconfig.comfy_url().rstrip("/") + "/queue", timeout=5).json()
        running = q.get("queue_running") or []
        item = running[0] if running else None
        pid = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else None
        extra = item[3] if isinstance(item, (list, tuple)) and len(item) > 3 and isinstance(item[3], dict) else {}
        sid = extra.get("client_id") if extra else None
    except Exception:
        pid, sid = None, None
    _discover_cache = (now, pid, sid)
    return pid, sid


def _follow_queue_job(force=False):
    pid, qsid = _discover_running_job(force=force)
    if qsid or pid:
        _adopt_watch_client(qsid, pid)
    return pid, qsid


def _watch_sid():
    pid, qsid = _follow_queue_job(force=True)
    if qsid:
        return qsid
    with _progress_lock:
        sid = _watch_client_id
    return sid or "imagine-progress"


def _fanout_browser(msg):
    if not isinstance(msg, dict):
        return
    typ = msg.get("type")
    if typ in ("status", "umeairt.monitor"):
        return
    try:
        raw = json.dumps(msg)
    except Exception:
        return
    with _progress_lock:
        subs = list(_ws_subscribers)
    for q in subs:
        try:
            q.put_nowait(raw)
        except Exception:
            pass


def _ensure_progress_watcher():
    global _watcher_started
    with _progress_lock:
        if _watcher_started:
            return
        _watcher_started = True
    threading.Thread(target=_comfy_progress_watch, daemon=True).start()


def _comfy_progress_watch():
    """Hold the job client_id socket so H3 progress is not dropped during long silent steps."""
    while True:
        cw = None
        sid = _watch_sid()
        try:
            base = appconfig.comfy_url()
            url = base.replace("http", "ws", 1).rstrip("/") + "/ws?clientId=" + sid
            cw = wsclient.create_connection(url, timeout=15)
            try:
                cw.settimeout(2.5)
            except Exception:
                pass
            _mark_watch_connected(sid)
            _watch_kick.clear()
            last_q = time.time()
            while True:
                now = time.time()
                if _watch_kick.is_set() or now - last_q > 2:
                    _watch_kick.clear()
                    last_q = now
                    nxt = _watch_sid()
                    if nxt != sid:
                        break
                try:
                    msg = cw.recv()
                except Exception as e:
                    if _is_ws_idle_timeout(e):
                        nxt = _watch_sid()
                        if nxt != sid:
                            break
                        try:
                            cw.ping()
                        except Exception:
                            break
                        continue
                    break
                if isinstance(msg, bytes):
                    if msg and msg[:1] in (b"{", b"["):
                        try:
                            text = msg.decode("utf-8")
                            _ingest_comfy_msg(text)
                        except Exception:
                            pass
                        continue
                    try:
                        _fanout_browser({
                            "type": "preview_bin",
                            "data": base64.b64encode(msg).decode("ascii"),
                        })
                    except Exception:
                        pass
                    continue
                _ingest_comfy_msg(msg)
        except Exception:
            time.sleep(2)
        finally:
            _mark_watch_connected(None)
            try:
                if cw is not None:
                    cw.close()
            except Exception:
                pass
            time.sleep(0.25)


def comfy_base(req=None):
    if req is not None:
        h = req.headers.get("X-Comfy-Url") or req.args.get("comfy")
        if h:
            return h.rstrip("/")
    return appconfig.comfy_url()


@app.after_request
def add_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Comfy-Url"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp


def ping_comfy(base):
    try:
        r = requests.get(base + "/system_stats", timeout=8)
        return r.status_code == 200
    except Exception:
        try:
            r = requests.get(base + "/object_info", timeout=8)
            return r.status_code == 200
        except Exception:
            return False


def comfy_info(base):
    try:
        info = requests.get(base + "/object_info", timeout=10).json()
    except Exception:
        return None, {}

    def choices(node, field):
        try:
            spec = info[node]["input"]
            box = spec.get("required", {}).get(field) or spec.get("optional", {}).get(field)
            if isinstance(box, list) and box and isinstance(box[0], list):
                return box[0]
        except Exception:
            pass
        return []

    lists = {
        "checkpoints": choices("CheckpointLoaderSimple", "ckpt_name"),
        "vaes": choices("VAELoader", "vae_name"),
        "loras": choices("LoraLoader", "lora_name"),
        "clips": choices("CLIPLoader", "clip_name"),
        "unets": choices("UNETLoader", "unet_name"),
        "samplers": choices("KSampler", "sampler_name"),
        "schedulers": choices("KSampler", "scheduler"),
        "has_vhs": "VHS_VideoCombine" in info,
        "has_h3": "MiniMaxH3ImageToVideo" in info,
        "has_h3_r2v": "MiniMaxH3ReferenceToVideo" in info,
        "has_qwen_edit": "TextEncodeQwenImageEditPlus" in info,
    }
    return info, lists


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def api_options(_any):
    return ("", 204)


def _maybe_autostart_setup(cfg, root):
    """Skip the first-run wizard when a real models folder is already here."""
    if cfg.get("setup_done"):
        return cfg
    if root and os.path.isdir(root):
        scanned = packs.scan_models(root)
        if scanned.get("all"):
            return appconfig.save({"models_root": root, "setup_done": True})
    return cfg


def session_state(req=None):
    cfg = appconfig.load()
    root = packs.detect_models_root()
    cfg = _maybe_autostart_setup(cfg, root)
    want = bool(cfg.get("connected", True))
    base = comfy_base(req)
    online = ping_comfy(base) if want else False
    exists = bool(root and os.path.isdir(root))
    saved_comfy = (cfg.get("comfy_root") or "").strip()
    comfy_info = comfy_ctl.inspect(saved_comfy)
    return {
        "comfy_url": base,
        "models_root": root,
        "models_root_exists": exists,
        "comfy_root": comfy_info.get("root") or saved_comfy,
        "comfy_install": comfy_info,
        "connected": want,
        "online": online,
        "setup_done": bool(cfg.get("setup_done")) and exists,
        "setup_needed": not (bool(cfg.get("setup_done")) and exists),
        "defaults": appconfig.mode_defaults(),
        "guesses": appconfig.guess_paths(),
        "download_jobs": downloads.list_jobs(),
    }


def decorate_catalog(catalog, req=None):
    sess = session_state(req)
    scanned = catalog.pop("scanned", None)
    if scanned is None:
        scanned = packs.scan_models(catalog.get("models_root"))
    downloads.attach_assets(catalog, scanned)
    catalog.update(sess)
    catalog["samplers"] = catalog.get("samplers") or [
        "euler", "euler_cfg_pp", "euler_ancestral", "dpmpp_2m", "dpmpp_sde", "heun"
    ]
    catalog["schedulers"] = catalog.get("schedulers") or [
        "simple", "sgm_uniform", "karras", "normal", "beta", "exponential"
    ]
    if sess.get("online"):
        try:
            _info, lists = comfy_info(sess["comfy_url"])
            if lists.get("samplers"):
                catalog["samplers"] = lists["samplers"]
            if lists.get("schedulers"):
                catalog["schedulers"] = lists["schedulers"]
            catalog["has_h3"] = bool(lists.get("has_h3"))
            catalog["has_h3_r2v"] = bool(lists.get("has_h3_r2v"))
        except Exception:
            pass
    return catalog


@app.route("/api/status")
def status():
    return jsonify(dict(ok=True, **session_state(request)))


@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    if request.method == "POST":
        data = request.get_json(force=True) or {}
        updates = {}
        if "comfy_url" in data and data["comfy_url"]:
            updates["comfy_url"] = str(data["comfy_url"]).rstrip("/")
        if "models_root" in data:
            root = appconfig.resolve_models_dir(data["models_root"])
            if data["models_root"] and not root:
                return jsonify({"ok": False, "error": "That folder does not exist."}), 400
            if root:
                updates["models_root"] = root
                updates["setup_done"] = True
        if "comfy_root" in data:
            raw = str(data.get("comfy_root") or "").strip()
            if raw:
                resolved = comfy_ctl.resolve_comfy_root(raw)
                if not resolved:
                    return jsonify({"ok": False, "error": "That folder is not a ComfyUI install. Pick the portable folder (the one with python_embeded) or the ComfyUI folder."}), 400
                updates["comfy_root"] = resolved
            else:
                updates["comfy_root"] = ""
        if "connected" in data:
            updates["connected"] = bool(data["connected"])
        if "defaults" in data and isinstance(data["defaults"], dict):
            d = appconfig.mode_defaults()
            for key in ("image", "video", "edit"):
                if data["defaults"].get(key):
                    d[key] = str(data["defaults"][key])
            updates["defaults"] = d
        if updates:
            appconfig.save(updates)
    return jsonify(dict(ok=True, **session_state(request)))


@app.route("/api/defaults", methods=["POST"])
def api_defaults():
    data = request.get_json(force=True) or {}
    mode = data.get("mode")
    pack_id = data.get("pack_id") or data.get("pack")
    if not pack_id:
        return jsonify({"ok": False, "error": "pack_id required"}), 400
    try:
        defaults = appconfig.set_mode_default(mode, pack_id)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True, "defaults": defaults})


@app.route("/api/connect", methods=["POST"])
def api_connect():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or data.get("comfy_url") or request.args.get("comfy") or "").rstrip("/")
    updates = {"connected": True}
    if url:
        updates["comfy_url"] = url
    appconfig.save(updates)
    sess = session_state(request)
    if not sess["online"]:
        return jsonify(dict(ok=False, error="ComfyUI did not answer at " + sess["comfy_url"], **sess))
    return jsonify(dict(ok=True, **sess))


@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    appconfig.save({"connected": False})
    return jsonify(dict(ok=True, **session_state(request)))


@app.route("/api/setup", methods=["POST"])
def api_setup():
    data = request.get_json(force=True) or {}
    raw = data.get("models_root") or data.get("path") or ""
    root = appconfig.resolve_models_dir(raw)
    if not root:
        return jsonify({"ok": False, "error": "Pick a folder that exists. ComfyUI root or its models folder both work."}), 400
    updates = {"models_root": root, "setup_done": True}
    if data.get("comfy_url"):
        updates["comfy_url"] = str(data["comfy_url"]).rstrip("/")
    if data.get("comfy_root"):
        resolved = comfy_ctl.resolve_comfy_root(data.get("comfy_root"))
        if resolved:
            updates["comfy_root"] = resolved
    if "connected" in data:
        updates["connected"] = bool(data["connected"])
    appconfig.save(updates)
    catalog = packs.build_catalog(None, models_root=root)
    return jsonify(decorate_catalog(catalog, request))


@app.route("/api/comfy/status", methods=["GET"])
def api_comfy_status():
    sess = session_state(request)
    info = sess.get("comfy_install") or comfy_ctl.inspect(sess.get("comfy_root") or "")
    return jsonify(dict(ok=True, online=sess.get("online"), **info, **{
        "comfy_url": sess.get("comfy_url"),
        "comfy_root": sess.get("comfy_root") or info.get("root") or "",
    }))


@app.route("/api/comfy/start", methods=["POST"])
def api_comfy_start():
    data = request.get_json(silent=True) or {}
    raw = (data.get("comfy_root") or data.get("path") or "").strip()
    if raw:
        resolved = comfy_ctl.resolve_comfy_root(raw)
        if not resolved:
            return jsonify({
                "ok": False,
                "error": "That folder is not a ComfyUI install. Pick the portable folder (python_embeded) or the ComfyUI folder.",
            }), 400
        appconfig.save({"comfy_root": resolved})
    else:
        resolved = comfy_ctl.guess_comfy_root(appconfig.comfy_root_override() or "")
    info = comfy_ctl.inspect(resolved)
    if ping_comfy(appconfig.comfy_url()):
        sess = session_state(request)
        return jsonify(dict(ok=True, already=True, started=False, **sess))
    if not info.get("can_start"):
        return jsonify({
            "ok": False,
            "error": info.get("label") or "Set a Windows portable ComfyUI folder first (the folder with python_embeded).",
            **info,
        }), 400
    rc = comfy_ctl.start(info.get("root"))
    if rc != 0:
        return jsonify({
            "ok": False,
            "error": "Could not start ComfyUI from that folder.",
            **info,
        }), 500
    return jsonify(dict(ok=True, started=True, already=False, **session_state(request)))


@app.route("/api/browse-folder", methods=["POST"])
def api_browse_folder():
    if os.name != "nt":
        return jsonify({"ok": False, "error": "Folder browse is Windows-only. Paste the path instead."}), 400
    script = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
        "$d.Description = 'Select ComfyUI, the portable folder, or ComfyUI\\\\models'; "
        "$d.ShowNewFolderButton = $false; "
        "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { "
        "Write-Output $d.SelectedPath }"
    )
    try:
        import subprocess
        r = subprocess.run(
            ["powershell", "-STA", "-NoProfile", "-Command", script],
            capture_output=True, text=True, timeout=300,
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    path = (r.stdout or "").strip()
    if not path:
        return jsonify({"ok": True, "cancelled": True, "path": ""})
    resolved = appconfig.resolve_models_dir(path) or path
    comfy = comfy_ctl.resolve_comfy_root(path) or ""
    return jsonify({"ok": True, "path": path, "models_root": resolved, "comfy_root": comfy})


@app.route("/api/downloads", methods=["GET", "POST"])
def api_downloads():
    if request.method == "GET":
        return jsonify({"ok": True, "jobs": downloads.list_jobs()})
    data = request.get_json(force=True) or {}
    pack_id = data.get("pack_id")
    asset_id = data.get("asset_id")
    try:
        job = downloads.start_download(pack_id, asset_id, packs.detect_models_root())
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({"ok": True, "job": job, "jobs": downloads.list_jobs()})


@app.route("/api/downloads/cancel", methods=["POST"])
def api_downloads_cancel():
    data = request.get_json(force=True) or {}
    job = downloads.cancel_job(data.get("id") or data.get("job_id"))
    return jsonify({"ok": True, "job": job, "jobs": downloads.list_jobs()})


@app.route("/api/packs")
@app.route("/api/scan")
def api_packs():
    catalog = packs.build_catalog(None)
    return jsonify(decorate_catalog(catalog, request))


@app.route("/api/packs/save", methods=["POST"])
def api_save_pack():
    data = request.get_json(force=True) or {}
    saved = packs.save_custom_pack(data)
    return jsonify({"ok": True, "pack": saved})


def _character_tags(data):
    tags = (data or {}).get("character_tags")
    if tags is None:
        tags = (data or {}).get("ref_names")
    if not isinstance(tags, list):
        return []
    return [str(x or "").strip() for x in tags]


def _scene_flags(data):
    flags = (data or {}).get("scene_flags")
    if flags is None:
        flags = (data or {}).get("ref_roles")
    if not isinstance(flags, list):
        return []
    out = []
    for x in flags:
        if isinstance(x, str):
            out.append(x.strip().lower() in ("scene", "setting", "pose", "location", "1", "true", "yes"))
        else:
            out.append(bool(x))
    return out


def _rewrite_from_data(data):
    data = data or {}
    try:
        ref_count = int(data.get("ref_count") or 0)
    except (TypeError, ValueError):
        ref_count = 0
    refs = data.get("ref_images") or []
    if not ref_count and isinstance(refs, list):
        ref_count = len([x for x in refs if x])
    tags = _character_tags(data)
    idea = data.get("idea") or data.get("prompt") or data.get("text") or data.get("shot") or ""
    return recipes.rewrite(
        idea,
        recipe=data.get("recipe") or data.get("pack") or "photo",
        mode=data.get("mode") or "t2i",
        style=data.get("style") or "",
        camera=data.get("camera") or "",
        has_image=bool(data.get("has_image") or data.get("init_image")),
        nsfw=bool(data.get("nsfw")),
        h3_path=data.get("h3_path") or "",
        ref_count=ref_count,
        has_last=bool(data.get("has_last") or data.get("last_image")),
        character_tags=tags,
        scene_flags=_scene_flags(data),
        duration=data.get("duration") or 0,
        want_audio=data.get("want_audio"),
        film=bool(data.get("film")),
        scene_lora=data.get("scene_lora") or "",
        dialogue=data.get("dialogue") or "",
        soundscape=data.get("soundscape") or "",
        music=data.get("music") or "",
    )


@app.route("/api/rewrite", methods=["POST"])
def api_rewrite():
    data = request.get_json(force=True) or {}
    text = _rewrite_from_data(data)
    return jsonify({"ok": True, "prompt": text, "source": "structure"})


@app.route("/api/llm-models")
def api_llm_models():
    return jsonify({
        "ok": True,
        "models": llm.list_models(),
        "engine": llm.engine_name(),
    })


@app.route("/api/llm-rewrite", methods=["POST"])
def api_llm_rewrite():
    data = request.get_json(force=True) or {}
    model = (data.get("model") or "").strip().lower()
    pack = (data.get("pack") or data.get("recipe") or "").strip().lower()
    shot = (data.get("shot") or data.get("text") or data.get("idea") or data.get("prompt") or "").strip()
    dialogue = data.get("dialogue") or ""
    soundscape = data.get("soundscape") or ""
    music = data.get("music") or ""
    if not model or model == llm.STRUCTURE_ID:
        return jsonify({
            "ok": True,
            "prompt": _rewrite_from_data(data),
            "source": "structure",
        })
    if pack and pack != "h3":
        text = _rewrite_from_data(data)
        return jsonify({
            "ok": True,
            "prompt": text,
            "source": "structure",
            "error": "Local rewrite is for MiniMax H3; used Structure.",
        })
    if not shot:
        return jsonify({"ok": False, "error": "Type what you want first."}), 400
    try:
        prompt = llm.rewrite_text(
            shot, dialogue=dialogue, soundscape=soundscape, music=music, model_id=model,
        )
        return jsonify({"ok": True, "prompt": prompt, "source": "llm"})
    except Exception as e:
        err = llm.friendly_error(e)
        if llm.is_ram_error(e) or err.startswith("Not enough RAM"):
            return jsonify({"ok": False, "error": err, "source": "llm"}), 507
        if "not found" in err.lower() or "not installed" in err.lower():
            return jsonify({"ok": False, "error": err, "source": "llm"}), 400
        text = _rewrite_from_data(data)
        prefix = "" if err.lower().startswith("local") else "Local model failed — used Structure. "
        return jsonify({
            "ok": True,
            "prompt": text,
            "source": "structure",
            "error": (prefix + err)[:240],
        })


@app.route("/api/models")
def models():
    base = comfy_base(request)
    info, lists = comfy_info(base)
    if info is None:
        return jsonify({"ok": False, "error": "ComfyUI offline"}), 502
    lists["ok"] = True
    return jsonify(lists)


@app.route("/api/upload", methods=["POST"])
def upload():
    base = comfy_base(request)
    f = request.files.get("image")
    if not f:
        return jsonify({"ok": False, "error": "no file"}), 400
    files = {"image": (f.filename, f.stream, f.mimetype)}
    try:
        r = requests.post(base + "/upload/image",
                          files=files, data={"overwrite": "true"}, timeout=30)
        return jsonify({"ok": True, "name": r.json().get("name", f.filename)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@app.route("/api/generate", methods=["POST"])
def generate():
    if not appconfig.want_connected():
        return jsonify({"ok": False, "error": "Connect ComfyUI first."}), 409
    base = comfy_base(request)
    if not ping_comfy(base):
        return jsonify({"ok": False, "error": "ComfyUI is offline at " + base}), 502
    params = request.get_json(force=True)
    refs = params.get("ref_images") or []
    recipe = params.get("prompt_recipe") or params.get("family") or "photo"
    path = (params.get("h3_path") or "").lower()
    tags = _character_tags(params)
    flags = _scene_flags(params)
    ref_n = len(refs) if isinstance(refs, list) else 0
    raw = params.get("prompt") or ""
    if (recipe or "").lower() == "h3" and raw.strip():
        params["prompt"] = recipes.rewrite(
            raw,
            recipe=recipe,
            mode=params.get("mode") or "",
            has_image=bool(params.get("init_image")),
            nsfw=bool(params.get("nsfw")),
            h3_path=path or ("r2v" if params.get("film_still") else ""),
            ref_count=ref_n,
            has_last=bool(params.get("last_image")),
            character_tags=tags,
            scene_flags=flags,
            duration=params.get("duration") or 0,
            want_audio=bool(params.get("audio_vae")),
            film=bool(params.get("film_clip")),
            scene_lora=params.get("scene_lora") or "",
            dialogue=params.get("dialogue") or "",
            soundscape=params.get("soundscape") or "",
            music=params.get("music") or "",
        )
    if params.get("nsfw"):
        prompt, neg = recipes.ensure_nsfw(
            params.get("prompt") or "",
            recipe=recipe,
            has_image=bool(params.get("init_image")),
            nsfw=True,
            neg=params.get("neg") or "",
            mode=params.get("mode") or "",
            h3_path=path or ("r2v" if params.get("film_still") else ""),
            ref_count=ref_n,
            has_last=bool(params.get("last_image")),
            character_tags=tags,
            scene_flags=flags,
            duration=params.get("duration") or 0,
            want_audio=bool(params.get("audio_vae")),
            film=bool(params.get("film_clip")),
            scene_lora=params.get("scene_lora") or "",
            dialogue=params.get("dialogue") or "",
            soundscape=params.get("soundscape") or "",
            music=params.get("music") or "",
        )
        params["prompt"] = prompt
        params["neg"] = neg

    skipped = []
    try:
        skipped = lora_compat.filter_loras(params)
        graph = graphs.build(params)
    except KeyError as e:
        return jsonify({"ok": False, "error": f"missing parameter: {e}"}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": f"graph build failed: {e}"}), 400

    client_id = params.get("client_id", "imagine")
    _adopt_watch_client(client_id)
    _ensure_progress_watcher()
    _watch_kick.set()
    _wait_watch_connected(client_id, 2.0)
    try:
        r = requests.post(base + "/prompt",
                          json={"prompt": graph, "client_id": client_id}, timeout=30)
        if r.status_code != 200:
            return jsonify({"ok": False, "error": r.text}), 400
        prompt_id = r.json().get("prompt_id")
        _reset_progress(prompt_id, client_id)
        return jsonify({
            "ok": True,
            "prompt_id": prompt_id,
            "graph": graph,
            "skipped_loras": skipped,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@app.route("/api/film/last-frame", methods=["POST"])
def api_film_last_frame():
    data = request.get_json(force=True) or {}
    try:
        out = film.extract_last_frame(
            data.get("filename") or "",
            data.get("subfolder") or "",
            data.get("type") or "output",
        )
        return jsonify(out)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


def _save_uploaded_video():
    f = request.files.get("file") or request.files.get("video")
    if not f:
        return None
    name = os.path.basename(f.filename or "")
    ext = os.path.splitext(name)[1].lower()
    if ext not in VIDEO_EXTS:
        raise ValueError("Drop an mp4 (or webm/mov) to grab a frame.")
    dest_dir = library.output_root()
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, name)
    if os.path.isfile(dest):
        stem, extn = os.path.splitext(name)
        name = stem + "_yi" + uuid_hex() + extn
        dest = os.path.join(dest_dir, name)
    f.save(dest)
    return {"filename": name, "subfolder": "", "type": "output"}


@app.route("/api/film/frame", methods=["POST"])
def api_film_frame():
    data = request.get_json(silent=True) or {}
    try:
        time_sec = data.get("time")
        if time_sec is None:
            time_sec = request.form.get("time", 0)
        uploaded = None
        if request.files:
            uploaded = _save_uploaded_video()
        filename = (uploaded or {}).get("filename") or data.get("filename") or request.form.get("filename") or ""
        subfolder = (uploaded or {}).get("subfolder") or data.get("subfolder") or request.form.get("subfolder") or ""
        type_name = (uploaded or {}).get("type") or data.get("type") or request.form.get("type") or "output"
        if not filename:
            return jsonify({"ok": False, "error": "Pick a video, then grab a frame."}), 400
        out = film.extract_frame(filename, subfolder, type_name, time_sec)
        if uploaded:
            out["source"] = uploaded
        return jsonify(out)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/film/concat", methods=["POST"])
def api_film_concat():
    data = request.get_json(force=True) or {}
    try:
        out = film.concat_clips(data.get("clips") or data.get("items") or [])
        return jsonify(out)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/film/stories", methods=["GET", "POST"])
def api_film_stories():
    if request.method == "GET":
        return jsonify({"ok": True, "stories": stories.list_stories()})
    data = request.get_json(force=True) or {}
    snap = data.get("snap") if isinstance(data.get("snap"), dict) else data
    try:
        out = stories.save_story(data.get("title") or (snap or {}).get("title"), snap or {})
        return jsonify(out)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except OSError as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/film/stories/<name>", methods=["GET"])
def api_film_story(name):
    try:
        data = stories.load_story(name)
        return jsonify({"ok": True, "id": name, "snap": data})
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "Story not found"}), 404
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except OSError as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/film/upload", methods=["POST"])
def api_film_upload():
    f = request.files.get("file") or request.files.get("video") or request.files.get("image")
    if not f:
        return jsonify({"ok": False, "error": "no file"}), 400
    name = os.path.basename(f.filename or "")
    ext = os.path.splitext(name)[1].lower()
    if ext not in VIDEO_EXTS:
        return jsonify({"ok": False, "error": "Drop an mp4 (or webm/mov) for a clip video."}), 400
    dest_dir = library.output_root()
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, name)
    if os.path.isfile(dest):
        stem, extn = os.path.splitext(name)
        name = stem + "_yi" + uuid_hex() + extn
        dest = os.path.join(dest_dir, name)
    try:
        f.save(dest)
    except OSError as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({
        "ok": True,
        "filename": name,
        "subfolder": "",
        "type": "output",
        "kind": "video",
    })


def uuid_hex():
    import uuid
    return uuid.uuid4().hex[:6]


@app.route("/api/health")
def health():
    return jsonify({"ok": True})


@app.route("/api/shutdown", methods=["POST"])
def api_shutdown():
    ctl = os.path.join(HERE, "comfy_ctl.py")
    root = os.environ.get("COMFY_ROOT") or "-"
    port = str(int(os.environ.get("PORT") or "7860"))
    args = [sys.executable, ctl, "shutdown-all", root, port]
    kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
        "cwd": HERE,
    }
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200 | 0x08000000 | 0x01000000
    subprocess.Popen(args, **kwargs)
    return jsonify({"ok": True})


def _restart_marker_path():
    return os.path.join(os.environ.get("TEMP") or os.environ.get("TMP") or HERE, _RESTART_MARK)


def _write_restart_marker():
    try:
        with open(_restart_marker_path(), "w", encoding="utf-8") as fh:
            fh.write(str(os.getpid()))
    except Exception:
        pass


def _clear_restart_marker():
    try:
        os.remove(_restart_marker_path())
    except Exception:
        pass


def _spawn_flask_worker(env=None):
    env = dict(os.environ if env is None else env)
    env["YI_FLASK_WORKER"] = "1"
    kwargs = {
        "cwd": HERE,
        "env": env,
        "stdin": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000200
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen([sys.executable, os.path.abspath(__file__)], **kwargs)


@app.route("/api/restart", methods=["POST"])
def restart_imagine():
    global _restarting
    _restarting = True
    _write_restart_marker()

    def _stop():
        time.sleep(0.35)
        httpd = _httpd
        if httpd is not None:
            httpd.shutdown()

    threading.Thread(target=_stop, daemon=True).start()
    return jsonify({"ok": True, "reloading": True})


@app.route("/api/interrupt", methods=["POST"])
def interrupt():
    base = comfy_base(request)
    try:
        requests.post(base + "/interrupt", timeout=10)
        try:
            requests.post(base + "/queue", json={"clear": True}, timeout=10)
        except Exception:
            pass
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@app.route("/api/negatives")
def api_negatives():
    return jsonify({"ok": True, "items": appconfig.load_negatives()})


@app.route("/api/negatives", methods=["POST"])
def api_save_negatives():
    data = request.get_json(force=True) or {}
    items = data.get("items") if isinstance(data.get("items"), list) else data
    if not isinstance(items, list):
        return jsonify({"ok": False, "error": "expected a list of saved negatives"}), 400
    saved = appconfig.save_negatives(items)
    return jsonify({"ok": True, "items": saved})


@app.route("/api/history/<prompt_id>")
def history(prompt_id):
    base = comfy_base(request)
    try:
        return jsonify(requests.get(base + f"/history/{prompt_id}", timeout=15).json())
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502


def _store_progress(value, max_value, node=None, prompt_id=None, note=""):
    try:
        value = float(value)
        max_value = float(max_value)
    except (TypeError, ValueError):
        return
    if max_value <= 0:
        return
    if max_value <= 1 and not (0 < value < 1) and not (1 < value <= 100):
        return
    pct = 100.0 * value if max_value == 1 and value <= 1 else 100.0 * (value / max_value)
    pct = max(0, min(100, pct))
    with _progress_lock:
        if prompt_id and _progress.get("prompt_id") and str(_progress.get("prompt_id")) != str(prompt_id):
            _progress.update({"value": 0, "max": 0, "pct": 0, "node": None, "note": ""})
        prev = float(_progress.get("pct") or 0)
        prev_max = float(_progress.get("max") or 0)
        prev_val = float(_progress.get("value") or 0)
        if prev_max > 1 and prev_val >= 1:
            if max_value <= 1:
                if prompt_id:
                    _progress["prompt_id"] = prompt_id
                return
            if value < 1:
                if prompt_id:
                    _progress["prompt_id"] = prompt_id
                return
            if pct + 2 < prev and max_value > prev_max * 2:
                if prompt_id:
                    _progress["prompt_id"] = prompt_id
                return
        if pct + 0.5 < prev and pct < 2:
            if prompt_id:
                _progress["prompt_id"] = prompt_id
            return
        _progress.update({
            "prompt_id": prompt_id or _progress.get("prompt_id"),
            "value": value,
            "max": max_value,
            "pct": round(pct, 2),
            "node": node if node is not None else _progress.get("node"),
            "note": note or _progress.get("note") or "",
            "ts": time.time(),
        })


def _pairs_from_node(node):
    pairs = []
    if not isinstance(node, dict):
        return pairs
    sources = [node]
    nested = node.get("progress")
    if isinstance(nested, dict):
        sources.append(nested)
    elif isinstance(nested, (int, float)):
        frac = float(nested)
        if 0 < frac <= 1:
            pairs.append((frac, 1.0))
        elif 1 < frac <= 100:
            pairs.append((frac, 100.0))
    aliases = (("value", "max"), ("current", "total"), ("step", "steps"), ("current_step", "total_steps"))
    for src in sources:
        if not isinstance(src, dict):
            continue
        for vk, mk in aliases:
            if vk not in src or mk not in src:
                continue
            try:
                val = float(src[vk])
                mx = float(src[mk])
            except (TypeError, ValueError):
                continue
            if mx <= 0:
                continue
            pairs.append((val, mx))
    return pairs


def _prefer_step_pair(pairs):
    if not pairs:
        return None
    live = [c for c in pairs if c[1] > 1 and c[0] >= 1]
    if live:
        return max(live, key=lambda c: (c[0] / c[1] if c[1] else 0, c[0], c[1]))
    frac = [c for c in pairs if c[1] == 1 and 0 < c[0] < 1]
    if frac:
        return max(frac, key=lambda c: c[0])
    pct = [(c[0], 100.0) for c in pairs if c[1] == 1 and 1 < c[0] <= 100]
    if pct:
        return max(pct, key=lambda c: c[0])
    return None


def _node_step_pair(node):
    return _prefer_step_pair(_pairs_from_node(node))


def _select_progress_nodes(nodes):
    """Pick sampler steps (max>1, value>=1). Ignore loader 0/N and busy 1/1 when a sampler exists."""
    if not isinstance(nodes, dict):
        return None
    live = []
    for nid, node in nodes.items():
        if not isinstance(node, dict):
            continue
        st = str(node.get("state") or "").lower()
        if st in ("finished", "pending", "error"):
            continue
        pair = _node_step_pair(node)
        if not pair:
            continue
        val, mx = pair
        if mx > 1 and val >= 1:
            ratio = val / mx if mx else 0
            boost = 2 if str(nid) in ("30",) or "sampler" in str(node.get("class_type") or node.get("type") or "").lower() else 0
            live.append(((ratio, boost, val), val, mx, nid or node.get("node_id")))
    if live:
        live.sort(key=lambda x: x[0], reverse=True)
        return live[0][1], live[0][2], live[0][3]
    return None


def _ingest_comfy_msg(raw):
    if isinstance(raw, bytes):
        if not raw or raw[:1] not in (b"{", b"["):
            return
        try:
            raw = raw.decode("utf-8")
        except Exception:
            return
    if not isinstance(raw, str) or not raw.startswith("{"):
        return
    try:
        msg = json.loads(raw)
    except Exception:
        return
    if not isinstance(msg, dict):
        return
    typ = msg.get("type")
    data = msg.get("data") if isinstance(msg.get("data"), dict) else {}
    if typ in ("executing", "execution_error", "execution_interrupted", "execution_start", "progress", "progress_state"):
        _fanout_browser(msg)
    if typ == "progress":
        pair = _prefer_step_pair(_pairs_from_node(data))
        if pair:
            _store_progress(pair[0], pair[1], data.get("node"), data.get("prompt_id"))
        return
    if typ == "executing":
        pid = data.get("prompt_id")
        if pid:
            with _progress_lock:
                if _progress.get("prompt_id") and str(_progress.get("prompt_id")) != str(pid):
                    _progress.update({"value": 0, "max": 0, "pct": 0, "node": None, "note": ""})
                _progress["prompt_id"] = pid
                _progress["ts"] = time.time()
        return
    if typ != "progress_state":
        return
    nodes = data.get("nodes") if isinstance(data.get("nodes"), dict) else {}
    best = _select_progress_nodes(nodes)
    if best:
        _store_progress(best[0], best[1], best[2], data.get("prompt_id"))


@app.route("/api/progress")
def api_progress():
    _ensure_progress_watcher()
    pid, sid = _follow_queue_job(force=True)
    with _progress_lock:
        snap = dict(_progress)
        snap["pump"] = "queue-watch"
        if pid and not snap.get("prompt_id"):
            snap["prompt_id"] = pid
        if sid and not snap.get("client_id"):
            snap["client_id"] = sid
        return jsonify(snap)


@app.route("/api/queue")
def api_queue():
    base = comfy_base(request)
    try:
        return jsonify(requests.get(base + "/queue", timeout=10).json())
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@app.route("/api/library")
def api_library():
    return jsonify(library.catalog())


@app.route("/api/library/remember", methods=["POST"])
def api_library_remember():
    data = request.get_json(force=True) or {}
    items = library.remember(data)
    return jsonify({"ok": True, "history": items})


@app.route("/api/library/delete", methods=["POST"])
def api_library_delete():
    data = request.get_json(force=True) or {}
    try:
        result = library.delete_media(
            data.get("filename") or "",
            data.get("subfolder") or "",
            data.get("type") or "output",
        )
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except OSError as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    cat = library.catalog()
    cat.update(result)
    return jsonify(cat)


VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv"}

@app.route("/api/view")
def view():
    base = comfy_base(request)
    params = request.args.to_dict()
    params.pop("comfy", None)
    filename = params.get("filename") or ""
    is_video = os.path.splitext(filename)[1].lower() in VIDEO_EXTS
    fwd = {}
    if is_video and request.headers.get("Range"):
        fwd["Range"] = request.headers["Range"]
    try:
        r = requests.get(base + "/view", params=params, headers=fwd, stream=True, timeout=120)
        if r.status_code >= 400:
            raise RuntimeError("ComfyUI view " + str(r.status_code))
        ctype = r.headers.get("Content-Type") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        extra = {}
        for h in ("Content-Length", "Content-Disposition"):
            if r.headers.get(h):
                extra[h] = r.headers[h]
        if is_video:
            for h in ("Content-Range", "Accept-Ranges"):
                if r.headers.get(h):
                    extra[h] = r.headers[h]
            extra.setdefault("Accept-Ranges", "bytes")
        return Response(
            r.iter_content(chunk_size=256 * 1024),
            status=r.status_code,
            content_type=ctype,
            headers=extra,
        )
    except Exception:
        try:
            path = library.resolve_media(
                filename,
                params.get("subfolder") or "",
                params.get("type") or "output",
            )
            if os.path.isfile(path):
                return send_from_directory(
                    os.path.dirname(path),
                    os.path.basename(path),
                    conditional=True,
                )
        except Exception:
            pass
        return jsonify({"ok": False, "error": "Could not open that file."}), 404


@sock.route("/ws")
def ws_bridge(browser_ws):
    _ensure_progress_watcher()
    _follow_queue_job(force=True)
    sid = request.args.get("clientId")
    pid, qsid = _discover_running_job()
    if not qsid and sid:
        _adopt_watch_client(sid, pid)
    stop = threading.Event()
    outgoing = queue.Queue(maxsize=256)
    with _progress_lock:
        _ws_subscribers.append(outgoing)

    def push():
        last_sig = None
        while not stop.is_set():
            try:
                raw = outgoing.get(timeout=0.4)
            except queue.Empty:
                raw = None
            if raw:
                try:
                    browser_ws.send(raw)
                except Exception:
                    stop.set()
                    return
            with _progress_lock:
                snap = dict(_progress)
            sig = (snap.get("prompt_id"), snap.get("value"), snap.get("max"), snap.get("pct"), snap.get("node"), snap.get("ts"))
            if sig != last_sig and float(snap.get("max") or 0) > 0:
                last_sig = sig
                try:
                    browser_ws.send(json.dumps({
                        "type": "progress",
                        "data": {
                            "value": snap.get("value"),
                            "max": snap.get("max"),
                            "node": snap.get("node"),
                            "prompt_id": snap.get("prompt_id"),
                        },
                    }))
                except Exception:
                    stop.set()
                    return

    t = threading.Thread(target=push, daemon=True)
    t.start()
    try:
        while True:
            data = browser_ws.receive()
            if data is None:
                break
    finally:
        stop.set()
        with _progress_lock:
            if outgoing in _ws_subscribers:
                _ws_subscribers.remove(outgoing)


@app.route("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/<path:path>")
def static_files(path):
    if path == "api" or path.startswith("api/"):
        return jsonify({"ok": False, "error": "not found"}), 404
    return send_from_directory(FRONTEND, path)


def _run_server():
    global _httpd, _restarting
    port = int(os.environ.get("PORT", "7860"))
    _restarting = False
    cfg = appconfig.load()
    root = packs.detect_models_root()
    print(f"\n  Your Imagination  http://127.0.0.1:{port}")
    print(f"  Talking to ComfyUI at  {cfg.get('comfy_url')}")
    print(f"  Models folder         {root}")
    if appconfig.media_hub_configured():
        try:
            print(f"  Media hub             {appconfig.media_hub_root()}\n")
        except Exception as e:
            print(f"  Media hub             {e}\n")
    else:
        print("  Media hub             (unset — using ComfyUI folders)\n")
    _ensure_progress_watcher()
    try:
        httpd = make_server("127.0.0.1", port, app, threaded=True)
    except OSError as e:
        busy = getattr(e, "winerror", None) == 10048 or "10048" in str(e) or "already in use" in str(e).lower()
        if busy:
            try:
                import comfy_ctl
                comfy_ctl.free_ui_port(port)
                httpd = make_server("127.0.0.1", port, app, threaded=True)
            except OSError:
                print(f"  Port {port} is already in use. Close the other Your Imagination window and try again.")
                raise SystemExit(1) from e
        else:
            raise
    _httpd = httpd
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
        _httpd = None
    return 0 if not _restarting else _RESTART_EXIT


def _supervisor():
    env = dict(os.environ)
    env["YI_FLASK_WORKER"] = "1"
    while True:
        _clear_restart_marker()
        proc = _spawn_flask_worker(env)
        try:
            rc = proc.wait()
        except KeyboardInterrupt:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
            return 1
        if rc == _RESTART_EXIT or os.path.exists(_restart_marker_path()):
            print("  Reloading Your Imagination…")
            time.sleep(0.3)
            continue
        return rc if isinstance(rc, int) else 0


if __name__ == "__main__":
    if os.environ.get("YI_FLASK_WORKER") == "1":
        raise SystemExit(_run_server())
    raise SystemExit(_supervisor())
