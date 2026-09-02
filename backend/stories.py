"""Film story snaps on disk so a board survives other browsers / agent sessions."""

from __future__ import annotations

import json
import os
import re
import time

import appconfig

STORIES_DIR = os.path.join(appconfig.DATA_DIR, "stories")
NOTES_WIP = os.path.join(appconfig.DATA_DIR, "after-the-door-closes-wip.json")
_SAFE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$")


def _slug(title):
    raw = re.sub(r"[^a-zA-Z0-9]+", "-", str(title or "story").strip()).strip("-").lower()
    return (raw or "story")[:80]


def _story_path(name):
    slug = os.path.basename(str(name or "").replace("\\", "/"))
    if not _SAFE.match(slug):
        raise ValueError("Invalid story name")
    if not slug.endswith(".json"):
        slug += ".json"
    os.makedirs(STORIES_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(STORIES_DIR, slug))
    root = os.path.abspath(STORIES_DIR)
    if os.path.normcase(os.path.commonpath([root, path])) != os.path.normcase(root):
        raise ValueError("Invalid story path")
    return path, slug[:-5]


def _read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("Story file is not an object")
    return data


def _title_of(data, fallback):
    if data.get("title"):
        return str(data["title"])
    snap = data.get("snap")
    if isinstance(snap, dict) and snap.get("title"):
        return str(snap["title"])
    return fallback


def list_stories():
    out = []
    seen = set()
    if os.path.isdir(STORIES_DIR):
        for fn in sorted(os.listdir(STORIES_DIR)):
            if not fn.endswith(".json"):
                continue
            path = os.path.join(STORIES_DIR, fn)
            try:
                data = _read_json(path)
            except (OSError, ValueError):
                continue
            slug = fn[:-5]
            seen.add(slug)
            try:
                ts = int(os.path.getmtime(path) * 1000)
            except OSError:
                ts = 0
            out.append({
                "id": slug,
                "title": _title_of(data, slug),
                "ts": ts,
                "source": "disk",
            })
    if os.path.isfile(NOTES_WIP) and "after-the-door-closes" not in seen:
        try:
            data = _read_json(NOTES_WIP)
            try:
                ts = int(os.path.getmtime(NOTES_WIP) * 1000)
            except OSError:
                ts = 0
            out.append({
                "id": "after-the-door-closes-wip",
                "title": _title_of(data, "After the Door Closes"),
                "ts": ts,
                "source": "notes",
            })
        except (OSError, ValueError):
            pass
    out.sort(key=lambda x: x.get("ts") or 0, reverse=True)
    return out


def _prefer_film_snap(data):
    """Notes WIPs may point at a real yi-film-snap; prefer that so clips keep videos."""
    if not isinstance(data, dict):
        return data
    if data.get("format") == "yi-film-snap" and isinstance(data.get("clips"), list):
        return data
    inner = data.get("snap")
    if isinstance(inner, dict) and isinstance(inner.get("clips"), list):
        return inner
    if isinstance(inner, str):
        base = os.path.basename(inner.replace("\\", "/"))
        if base.endswith(".json"):
            path = os.path.join(STORIES_DIR, base)
            if os.path.isfile(path):
                try:
                    return _read_json(path)
                except (OSError, ValueError):
                    pass
    return data


def load_story(name):
    slug = os.path.basename(str(name or "").replace("\\", "/"))
    if slug.endswith(".json"):
        slug = slug[:-5]
    if slug == "after-the-door-closes-wip" and os.path.isfile(NOTES_WIP):
        return _prefer_film_snap(_read_json(NOTES_WIP))
    path, _sid = _story_path(slug)
    if not os.path.isfile(path):
        raise FileNotFoundError("Story not found")
    return _prefer_film_snap(_read_json(path))


def save_story(title, snap):
    if not isinstance(snap, dict):
        raise ValueError("snap must be an object")
    body = dict(snap)
    body["format"] = body.get("format") or "yi-film-snap"
    body["title"] = str(title or body.get("title") or "Untitled story")
    slug = _slug(body["title"])
    path, sid = _story_path(slug)
    os.makedirs(STORIES_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, indent=2)
    os.replace(tmp, path)
    return {
        "ok": True,
        "id": sid,
        "title": body["title"],
        "ts": int(time.time() * 1000),
        "path": path,
    }
