"""Scan ComfyUI output files, persist generation history, delete from disk."""

from __future__ import annotations

import json
import os
import threading
import time

import appconfig
import packs

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv"}
HISTORY_MAX = 500

_lock = threading.Lock()
_HISTORY_PATH = os.path.join(appconfig.DATA_DIR, "history.json")


def _legacy_output_root():
    models = packs.detect_models_root()
    if models:
        comfy = os.path.dirname(models)
        cand = os.path.join(comfy, "output")
        if os.path.isdir(cand):
            return os.path.abspath(cand)
    sibling = os.path.join(appconfig.APP_ROOT, "..", "ComfyUI_windows_portable", "ComfyUI", "output")
    return os.path.abspath(sibling)


def output_root():
    if appconfig.media_hub_configured():
        appconfig.assert_media_hub_drive()
        path = os.path.abspath(appconfig.media_hub_output())
        os.makedirs(path, exist_ok=True)
        return path
    return _legacy_output_root()


def input_root():
    if appconfig.media_hub_configured():
        appconfig.assert_media_hub_drive()
        path = os.path.abspath(appconfig.media_hub_input())
        os.makedirs(path, exist_ok=True)
        return path
    return os.path.abspath(os.path.join(os.path.dirname(output_root()), "input"))


def _type_root(kind):
    if kind == "input":
        return input_root()
    return output_root()


def resolve_media(filename, subfolder="", type_name="output"):
    name = os.path.basename(str(filename or ""))
    if not name:
        raise ValueError("No filename")
    sub = str(subfolder or "").replace("\\", "/").strip("/")
    parts = [p for p in sub.split("/") if p and p not in (".", "..")]
    if ".." in name or "/" in str(filename).replace("\\", "/"):
        if os.path.basename(filename) != name:
            raise ValueError("Invalid filename")
    root = os.path.abspath(_type_root(type_name if type_name in ("output", "input") else "output"))
    path = os.path.abspath(os.path.join(root, *parts, name))
    try:
        common = os.path.commonpath([root, path])
    except ValueError:
        raise ValueError("Invalid path")
    if os.path.normcase(common) != os.path.normcase(root):
        raise ValueError("File is outside the media hub folder")
    return path


def _kind_for(name):
    ext = os.path.splitext(name)[1].lower()
    if ext in VIDEO_EXT:
        return "video"
    return "image"


def _load_history():
    try:
        with open(_HISTORY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except (OSError, ValueError):
        pass
    return []


def _save_history(items):
    os.makedirs(appconfig.DATA_DIR, exist_ok=True)
    tmp = _HISTORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items[:HISTORY_MAX], f, indent=2)
    os.replace(tmp, _HISTORY_PATH)


def _hist_same(a, b):
    pid_a = str(a.get("prompt_id") or "")
    pid_b = str(b.get("prompt_id") or "")
    if pid_a and pid_b:
        return (
            pid_a == pid_b
            and (a.get("filename") or "") == (b.get("filename") or "")
            and (a.get("subfolder") or "") == (b.get("subfolder") or "")
            and (a.get("type") or "output") == (b.get("type") or "output")
        )
    if pid_a or pid_b:
        return False
    return (
        (a.get("type") or "output") == (b.get("type") or "output")
        and (a.get("subfolder") or "") == (b.get("subfolder") or "")
        and (a.get("filename") or "") == (b.get("filename") or "")
    )


def remember(entry):
    filename = os.path.basename(entry.get("filename") or "")
    if not filename:
        return history_list()
    rec = {
        "filename": filename,
        "subfolder": entry.get("subfolder") or "",
        "type": entry.get("type") or "output",
        "kind": entry.get("kind") or _kind_for(filename),
        "prompt": entry.get("prompt") or "",
        "pack": entry.get("pack") or "",
        "pack_title": entry.get("pack_title") or "",
        "ts": int(entry.get("ts") or time.time() * 1000),
        "elapsed_ms": int(entry.get("elapsed_ms") or 0),
        "pct": int(entry.get("pct") or 0),
        "prompt_id": str(entry.get("prompt_id") or ""),
        "neg": entry.get("neg") or "",
        "settings": entry.get("settings") if isinstance(entry.get("settings"), dict) else {},
    }
    with _lock:
        items = _load_history()
        items = [x for x in items if not _hist_same(x, rec)]
        items.insert(0, rec)
        _save_history(items)
        return items


def forget(filename, subfolder="", type_name="output"):
    filename = os.path.basename(filename or "")
    with _lock:
        items = _load_history()
        items = [
            x for x in items
            if not (
                x.get("filename") == filename
                and (x.get("subfolder") or "") == (subfolder or "")
                and (x.get("type") or "output") == (type_name or "output")
            )
        ]
        _save_history(items)
        return items


def history_list():
    with _lock:
        return _load_history()


def prune_missing():
    """Drop history rows whose files were deleted in Explorer or elsewhere."""
    with _lock:
        items = _load_history()
        keep = []
        for h in items:
            try:
                path = resolve_media(
                    h.get("filename"),
                    h.get("subfolder") or "",
                    h.get("type") or "output",
                )
            except ValueError:
                continue
            if os.path.isfile(path):
                keep.append(h)
        if len(keep) != len(items):
            _save_history(keep)
        return keep


def _scan_root(root, type_name, limit=400):
    found = []
    if not os.path.isdir(root):
        return found
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in IMAGE_EXT and ext not in VIDEO_EXT:
                continue
            if fn.startswith("."):
                continue
            full = os.path.join(dirpath, fn)
            try:
                st = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, root).replace("\\", "/")
            folder, name = os.path.split(rel)
            if folder == ".":
                folder = ""
            found.append({
                "filename": name,
                "subfolder": folder,
                "type": type_name,
                "kind": _kind_for(name),
                "source": "uploaded" if type_name == "input" else "generated",
                "mtime": int(st.st_mtime * 1000),
                "size": st.st_size,
            })
            if len(found) >= limit * 2:
                break
    found.sort(key=lambda x: x["mtime"], reverse=True)
    return found[:limit]


def scan_gallery(limit=400):
    out = _scan_root(output_root(), "output", limit)
    inp = _scan_root(input_root(), "input", limit)
    found = out + inp
    found.sort(key=lambda x: x["mtime"], reverse=True)
    return found[:limit]


def catalog():
    prune_missing()
    hist = { (h.get("type") or "output", h.get("subfolder") or "", h.get("filename")): h for h in history_list() }
    gallery = []
    for item in scan_gallery():
        meta = hist.get((item["type"], item["subfolder"], item["filename"])) or {}
        row = dict(item)
        row["prompt"] = meta.get("prompt") or ""
        row["pack"] = meta.get("pack") or ""
        row["pack_title"] = meta.get("pack_title") or ""
        row["ts"] = meta.get("ts") or item["mtime"]
        row["source"] = item.get("source") or ("uploaded" if item.get("type") == "input" else "generated")
        gallery.append(row)
    history = []
    for h in history_list():
        try:
            path = resolve_media(h.get("filename"), h.get("subfolder") or "", h.get("type") or "output")
            exists = os.path.isfile(path)
        except ValueError:
            exists = False
        row = dict(h)
        row["exists"] = exists
        row["kind"] = h.get("kind") or _kind_for(h.get("filename") or "")
        history.append(row)
    hub = ""
    if appconfig.media_hub_configured():
        try:
            hub = appconfig.media_hub_root()
        except Exception:
            hub = ""
    return {
        "ok": True,
        "media_hub": hub,
        "output_root": output_root(),
        "input_root": input_root(),
        "gallery": gallery,
        "history": history,
    }


def delete_media(filename, subfolder="", type_name="output"):
    path = resolve_media(filename, subfolder, type_name)
    if not os.path.isfile(path):
        forget(filename, subfolder, type_name)
        return {"ok": True, "missing": True, "path": path}
    os.remove(path)
    # Comfy sometimes writes a matching .png preview next to video
    stem, ext = os.path.splitext(path)
    if ext.lower() in VIDEO_EXT:
        for extra in (stem + ".png", stem + ".webp"):
            if os.path.isfile(extra):
                try:
                    os.remove(extra)
                except OSError:
                    pass
    forget(filename, subfolder, type_name)
    return {"ok": True, "path": path}
