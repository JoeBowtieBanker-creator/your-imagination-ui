"""
packs.py — scan the local ComfyUI models folder and match pack recipes.

A pack is a known-good bundle (UNet + CLIP + VAE + recommended LoRAs).
We walk the models directory ourselves so gitignore / ComfyUI not-running
does not hide files. ComfyUI /object_info is merged when available.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.abspath(os.path.join(HERE, ".."))
PACKS_DIR = os.path.join(APP_ROOT, "packs")
CUSTOM_DIR = os.path.join(PACKS_DIR, "custom")

WEIGHT_EXT = {".safetensors", ".ckpt", ".pt", ".bin", ".gguf", ".sft", ".pth"}

SLOT_FOLDERS = {
    "unet": ("diffusion_models", "unet", "checkpoints"),
    "ref_unet": ("diffusion_models", "unet", "checkpoints"),
    "clip": ("text_encoders", "clip"),
    "vae": ("vae",),
    "audio_vae": ("vae",),
    "lora": ("loras", "Lora"),
}

FOLDER_LABEL = {
    "unet": "diffusion_models/",
    "ref_unet": "diffusion_models/",
    "clip": "text_encoders/",
    "vae": "vae/",
    "audio_vae": "vae/",
    "lora": "loras/",
}


def detect_models_root():
    env = os.environ.get("COMFY_MODELS")
    if env and os.path.isdir(env):
        return os.path.abspath(env)
    try:
        import appconfig
        override = appconfig.models_root_override()
        if override:
            return override
    except Exception:
        pass
    project = os.path.abspath(os.path.join(HERE, "..", ".."))
    candidates = [
        os.path.join(project, "ComfyUI_windows_portable", "ComfyUI", "models"),
        os.path.join(HERE, "..", "..", "ComfyUI_windows_portable", "ComfyUI", "models"),
        os.path.join(project, "ComfyUI", "models"),
    ]
    for c in candidates:
        c = os.path.abspath(c)
        if os.path.isdir(c):
            return c
    return os.path.abspath(candidates[0])


def _is_weight(path):
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    if ext not in WEIGHT_EXT:
        return False
    try:
        return os.path.getsize(path) > 1024
    except OSError:
        return False


def scan_models(models_root=None):
    """Return {folder_type: [relative filenames]} like ComfyUI object_info lists."""
    root = models_root or detect_models_root()
    out = {k: [] for k in ("diffusion_models", "unet", "checkpoints", "text_encoders", "clip", "vae", "loras")}
    if not os.path.isdir(root):
        return {"root": root, "files": out, "all": []}

    for folder in list(out.keys()):
        base = os.path.join(root, folder)
        if not os.path.isdir(base):
            continue
        found = []
        for dirpath, _dirs, files in os.walk(base):
            for fn in files:
                full = os.path.join(dirpath, fn)
                if not _is_weight(full):
                    continue
                rel = os.path.relpath(full, base).replace("\\", "/")
                found.append(rel)
        found.sort(key=lambda s: s.lower())
        out[folder] = found

    all_files = []
    for folder, names in out.items():
        for n in names:
            all_files.append({"folder": folder, "name": n, "key": f"{folder}/{n}"})
    return {"root": root, "files": out, "all": all_files}


def _pool_for_slot(files, slot):
    folders = SLOT_FOLDERS.get(slot, ("diffusion_models",))
    pool = []
    seen = set()
    for folder in folders:
        for name in files.get(folder, []):
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            pool.append(name)
    return pool


def _match_patterns(pool, patterns):
    if isinstance(patterns, str):
        patterns = [patterns]
    matches = []
    used = set()
    for pat in patterns or []:
        for name in pool:
            base = os.path.basename(name)
            if name in used:
                continue
            if fnmatch.fnmatch(name.lower(), pat.lower()) or fnmatch.fnmatch(base.lower(), pat.lower()):
                matches.append(name)
                used.add(name)
    return matches


def _resolve_lora_list(items, lora_pool):
    out = []
    for item in items or []:
        hits = _match_patterns(lora_pool, item.get("patterns") or [])
        out.append({
            "id": item.get("id"),
            "label": item.get("label") or item.get("id"),
            "patterns": item.get("patterns") or [],
            "strength": float(item.get("strength", 1.0)),
            "on": bool(item.get("on", True)) and bool(hits),
            "name": hits[0] if hits else None,
            "missing": not bool(hits),
            "need": item.get("need"),
        })
    return out


def load_pack_defs():
    defs = []
    for folder in (PACKS_DIR, CUSTOM_DIR):
        if not os.path.isdir(folder):
            continue
        for fn in sorted(os.listdir(folder)):
            if not fn.endswith(".json"):
                continue
            path = os.path.join(folder, fn)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                data["_path"] = path
                data["_custom"] = os.path.abspath(folder) == os.path.abspath(CUSTOM_DIR)
                defs.append(data)
            except Exception:
                continue
    return defs


def resolve_pack(defn, scanned):
    files = scanned["files"]
    resolved = {}
    missing = []
    candidates = {}
    spec = defn.get("files") or {}
    required = ["unet", "clip", "vae"]
    if "audio_vae" in spec:
        required.append("audio_vae")

    for slot, patterns in spec.items():
        pool = _pool_for_slot(files, slot)
        hits = _match_patterns(pool, patterns)
        candidates[slot] = hits
        if hits:
            resolved[slot] = hits[0]
        else:
            missing.append({
                "slot": slot,
                "folder": FOLDER_LABEL.get(slot, slot + "/"),
                "patterns": patterns if isinstance(patterns, list) else [patterns],
            })

    for slot, patterns in (defn.get("optional_files") or {}).items():
        pool = _pool_for_slot(files, slot)
        hits = _match_patterns(pool, patterns)
        candidates[slot] = hits
        if hits:
            resolved[slot] = hits[0]

    lora_pool = _pool_for_slot(files, "lora")
    rec = _resolve_lora_list(defn.get("recommended_loras") or [], lora_pool)
    nsfw = _resolve_lora_list(defn.get("nsfw_loras") or [], lora_pool)

    ready = all(slot in resolved for slot in required if slot in spec or slot in ("unet", "clip", "vae"))
    defaults = dict(defn.get("defaults") or {})
    unet_name = (resolved.get("unet") or "").lower()
    if defn.get("graph") == "flux2_klein":
        if "base" in os.path.basename(unet_name):
            defaults.update({"steps": 20, "cfg": 4.0, "sampler": "euler", "scheduler": "simple"})
        else:
            defaults.update({"steps": 4, "cfg": 1.0, "sampler": "euler", "scheduler": "simple"})

    return {
        "id": defn["id"],
        "title": defn.get("title", defn["id"]),
        "blurb": defn.get("blurb", ""),
        "modes": defn.get("modes") or ["t2i"],
        "family": defn.get("family", ""),
        "clip_type": defn.get("clip_type", "stable_diffusion"),
        "graph": defn.get("graph", defn["id"]),
        "prompt_recipe": defn.get("prompt_recipe", "photo"),
        "defaults": defaults,
        "custom": bool(defn.get("_custom")),
        "ready": ready,
        "resolved": resolved,
        "candidates": candidates,
        "missing": missing,
        "recommended_loras": rec,
        "nsfw_loras": nsfw,
    }


def claimed_keys(resolved_packs):
    claimed = set()
    for p in resolved_packs:
        r = p.get("resolved") or {}
        for slot, name in r.items():
            folders = SLOT_FOLDERS.get(slot, ("diffusion_models",))
            for folder in folders:
                claimed.add(f"{folder}/{name}")
        for rec in (p.get("recommended_loras") or []) + (p.get("nsfw_loras") or []):
            if rec.get("name"):
                claimed.add(f"loras/{rec['name']}")
    return claimed


def guess_family(name):
    n = name.lower()
    if "minimax" in n or "h3" in n:
        return "h3"
    if "qwen" in n and "edit" in n:
        return "qwen"
    if "qwen" in n:
        return "qwen"
    if "klein" in n or "flux-2" in n or "flux2" in n:
        return "flux2"
    if "z_image" in n or "z-image" in n:
        return "zimage"
    if "ltx" in n:
        return "ltx"
    if "flux" in n:
        return "flux"
    return "unknown"


def new_files(scanned, resolved_packs):
    claimed = claimed_keys(resolved_packs)
    out = []
    for item in scanned.get("all") or []:
        if item["key"] in claimed:
            continue
        if item["folder"] not in ("diffusion_models", "unet", "checkpoints"):
            continue
        out.append({
            "folder": item["folder"],
            "name": item["name"],
            "guess": guess_family(item["name"]),
        })
    return out


def build_catalog(comfy_info=None, models_root=None):
    scanned = scan_models(models_root)
    if comfy_info:
        mapping = {
            "checkpoints": "checkpoints",
            "vaes": "vae",
            "loras": "loras",
            "clips": "text_encoders",
        }
        files = scanned["files"]
        for src, dest in mapping.items():
            extra = comfy_info.get(src) or []
            have = {n.lower() for n in files.get(dest, [])}
            for name in extra:
                if name and name.lower() not in have:
                    files.setdefault(dest, []).append(name)
                    have.add(name.lower())
        unets = comfy_info.get("unets") or comfy_info.get("diffusion_models") or []
        have = {n.lower() for n in files.get("diffusion_models", [])}
        for name in unets:
            if name and name.lower() not in have:
                files.setdefault("diffusion_models", []).append(name)

    defs = load_pack_defs()
    packs = [resolve_pack(d, scanned) for d in defs]
    loras = scanned["files"].get("loras") or []
    return {
        "ok": True,
        "models_root": scanned["root"],
        "packs": packs,
        "loras": loras,
        "new_files": new_files(scanned, packs),
        "counts": {k: len(v) for k, v in scanned["files"].items()},
        "scanned": scanned,
    }


def save_custom_pack(payload):
    os.makedirs(CUSTOM_DIR, exist_ok=True)
    pack_id = re.sub(r"[^a-z0-9\-]+", "-", (payload.get("id") or "custom").lower()).strip("-")
    if not pack_id:
        pack_id = "custom"
    data = {
        "id": pack_id,
        "title": payload.get("title") or pack_id,
        "blurb": payload.get("blurb") or "Saved from Your Imagination.",
        "modes": payload.get("modes") or ["t2i"],
        "family": payload.get("family") or "custom",
        "clip_type": payload.get("clip_type") or "stable_diffusion",
        "graph": payload.get("graph") or "qwen_edit",
        "prompt_recipe": payload.get("prompt_recipe") or "photo",
        "files": payload.get("files") or {},
        "recommended_loras": payload.get("recommended_loras") or [],
        "nsfw_loras": payload.get("nsfw_loras") or [],
        "defaults": payload.get("defaults") or {},
    }
    path = os.path.join(CUSTOM_DIR, pack_id + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return data
