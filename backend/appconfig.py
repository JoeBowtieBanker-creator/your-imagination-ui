"""Persistent local settings: Comfy URL, models folder, connect intent."""

from __future__ import annotations

import json
import os
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.abspath(os.path.join(HERE, ".."))
DATA_DIR = os.path.join(APP_ROOT, "data")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")

# Shared ComfyUI + Imagine media hub (not inside ComfyUI; not the Nano dump).
# Set YI_MEDIA_HUB or config media_hub to a folder that contains input/ and output/.


def media_hub_configured():
    env = (os.environ.get("YI_MEDIA_HUB") or "").strip()
    if env:
        return env
    try:
        saved = (load().get("media_hub") or "").strip()
    except Exception:
        saved = ""
    return saved


def media_hub_root():
    raw = media_hub_configured()
    if not raw:
        raise FileNotFoundError(
            "Media hub is not set. Set YI_MEDIA_HUB to a folder with input/ and output/."
        )
    return os.path.normpath(os.path.abspath(os.path.expanduser(raw)))


def media_hub_input():
    return os.path.join(media_hub_root(), "input")


def media_hub_output():
    return os.path.join(media_hub_root(), "output")


def assert_media_hub_drive(root=None):
    """Fail clearly when the configured hub path is missing."""
    root = os.path.normpath(os.path.abspath(root or media_hub_root()))
    drive = os.path.splitdrive(root)[0]
    if drive and not os.path.isdir(drive + os.sep):
        raise FileNotFoundError(
            "Media hub drive " + drive + " is missing. Map or attach it, then retry. Expected " + root
        )
    parent = os.path.dirname(root)
    if parent and not os.path.isdir(parent):
        raise FileNotFoundError("Media hub path is not reachable: " + root)
    return root

_lock = threading.Lock()
_FALLBACK_DEFAULTS = {
    "image": "h3-video",
    "video": "h3-video",
    "edit": "h3-video",
}

_DEFAULTS = {
    "comfy_url": os.environ.get("COMFY_URL", "http://127.0.0.1:8188"),
    "models_root": "",
    "comfy_root": "",
    "connected": True,
    "setup_done": False,
    "defaults": dict(_FALLBACK_DEFAULTS),
    "media_hub": "",
}


def load():
    with _lock:
        data = dict(_DEFAULTS)
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                data.update(saved)
        except (OSError, ValueError):
            pass
        return data


def save(updates):
    with _lock:
        data = dict(_DEFAULTS)
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                data.update(saved)
        except (OSError, ValueError):
            pass
        data.update(updates or {})
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, CONFIG_PATH)
        return data


def comfy_url():
    return (load().get("comfy_url") or _DEFAULTS["comfy_url"]).rstrip("/")


def want_connected():
    return bool(load().get("connected", True))


def models_root_override():
    root = (load().get("models_root") or "").strip()
    if root and os.path.isdir(root):
        return os.path.abspath(root)
    return ""


def comfy_root_override():
    root = (load().get("comfy_root") or "").strip()
    if root and os.path.isdir(root):
        return os.path.abspath(root)
    return ""


def mode_defaults():
    cfg = load()
    d = dict(_FALLBACK_DEFAULTS)
    saved = cfg.get("defaults") or {}
    if isinstance(saved, dict):
        for key in ("image", "video", "edit"):
            if saved.get(key):
                d[key] = str(saved[key])
    return d


def set_mode_default(mode, pack_id):
    if mode not in ("image", "video", "edit"):
        raise ValueError("mode must be image, video, or edit")
    d = mode_defaults()
    d[mode] = pack_id
    save({"defaults": d})
    return d


def guess_paths():
    project = os.path.abspath(os.path.join(HERE, "..", ".."))
    home = os.path.expanduser("~")
    guesses = [
        os.path.join(project, "ComfyUI_windows_portable", "ComfyUI", "models"),
        os.path.join(home, "Documents", "ComfyUI", "models"),
        os.path.join(home, "ComfyUI", "models"),
        "C:\\ComfyUI\\models",
        "D:\\ComfyUI\\models",
    ]
    out = []
    seen = set()
    for g in guesses:
        g = os.path.abspath(g)
        if g.lower() in seen:
            continue
        seen.add(g.lower())
        out.append({"path": g, "exists": os.path.isdir(g)})
    return out


NEG_PATH = os.path.join(DATA_DIR, "negatives.json")
_DEFAULT_NEGS = [
    {
        "id": "quality",
        "name": "Quality",
        "text": "blurry, low quality, jpeg artifacts, watermark, text, logo, extra fingers, deformed hands",
    },
    {
        "id": "clean",
        "name": "Clean photo",
        "text": "illustration, cartoon, cgi, plastic skin, oversharpened",
    },
]


def load_negatives():
    with _lock:
        try:
            with open(NEG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and isinstance(data.get("items"), list):
                return data["items"]
        except (OSError, ValueError):
            pass
        return [dict(x) for x in _DEFAULT_NEGS]


def save_negatives(items):
    with _lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        clean = []
        seen = set()
        for it in items or []:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "").strip()
            text = str(it.get("text") or "").strip()
            if not name or not text:
                continue
            nid = str(it.get("id") or "").strip()
            if not nid:
                nid = "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-") or "neg"
            base = nid
            n = 2
            while nid in seen:
                nid = base + "-" + str(n)
                n += 1
            seen.add(nid)
            clean.append({"id": nid, "name": name, "text": text})
        tmp = NEG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(clean, f, indent=2)
        os.replace(tmp, NEG_PATH)
        return clean


def resolve_models_dir(path):
    """Accept Comfy root, ComfyUI folder, or models folder."""
    if not path:
        return ""
    path = os.path.abspath(os.path.expanduser(str(path).strip().strip('"')))
    if not os.path.isdir(path):
        return ""
    name = os.path.basename(path).lower()
    if name == "models" and os.path.isdir(path):
        return path
    for rel in (
        os.path.join("ComfyUI", "models"),
        os.path.join("ComfyUI_windows_portable", "ComfyUI", "models"),
        "models",
    ):
        cand = os.path.join(path, rel)
        if os.path.isdir(cand):
            return os.path.abspath(cand)
    return path
