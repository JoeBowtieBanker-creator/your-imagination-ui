"""Classify LoRA files from the safetensors header (no tensor load)."""

from __future__ import annotations

import json
import os
import struct

import packs

# Pack graph -> LoRA families that can actually attach.
# Unknown extras are kept except on Klein, which stays strict.
ALLOWED = {
    "flux2_klein": {"klein4b"},
    "qwen_edit": {"qwen"},
    "h3": {"h3"},
    "zimage": {"zimage"},
    "ltx": {"ltx"},
}
KEEP_UNKNOWN = {"h3", "qwen_edit", "zimage", "ltx"}

_LABEL = {
    "klein4b": "Klein 4B",
    "klein9b": "Klein 9B",
    "flux1": "Flux.1",
    "flux2_dev": "Flux.2 Dev",
    "sd15": "SD 1.5",
    "qwen": "Qwen",
    "h3": "MiniMax H3",
    "zimage": "Z-Image",
    "ltx": "LTX",
    "unknown": "unknown",
}


def _lora_path(name):
    if not name:
        return None
    rel = name.replace("/", os.sep).replace("\\", os.sep)
    root = packs.detect_models_root()
    for folder in ("loras", "Lora"):
        path = os.path.join(root, folder, rel)
        if os.path.isfile(path):
            return path
    return None


def _header(path):
    with open(path, "rb") as f:
        raw = f.read(8)
        if len(raw) < 8:
            return {}
        n = struct.unpack_from("<Q", raw)[0]
        if n <= 0 or n > 32 * 1024 * 1024:
            return {}
        meta = json.loads(f.read(n))
    meta.pop("__metadata__", None)
    return meta


def classify(path):
    """Return (family, reason)."""
    try:
        meta = _header(path)
    except Exception as e:
        return "unknown", str(e)
    if not meta:
        return "unknown", "empty header"

    keys = list(meta.keys())

    def shape(k):
        info = meta.get(k) or {}
        return tuple(info.get("shape") or [])

    in_dims = []
    max_double = -1
    max_single = -1
    has_lokr = False
    lokr_out = []

    for k, info in meta.items():
        sh = tuple(info.get("shape") or [])
        kl = k.lower()
        if "lokr" in kl:
            has_lokr = True
        # ai-toolkit Klein LoRAs use lora_A/lora_B; Kohya uses lora_down/lora_up.
        if len(sh) == 2 and (
            kl.endswith("lora_down.weight") or kl.endswith("lora_a.weight")
        ):
            in_dims.append(sh[1])
        if "double_blocks_" in kl or "double_blocks." in kl:
            try:
                part = k.replace("double_blocks_", "double_blocks.").split("double_blocks.")[1]
                max_double = max(max_double, int(part.split("_")[0].split(".")[0]))
            except (IndexError, ValueError):
                pass
        if "single_blocks_" in kl or "single_blocks." in kl:
            try:
                part = k.replace("single_blocks_", "single_blocks.").split("single_blocks.")[1]
                max_single = max(max_single, int(part.split("_")[0].split(".")[0]))
            except (IndexError, ValueError):
                pass
        if kl.endswith("lokr_w1") or kl.endswith("lokr_w2"):
            lokr_out.append((k, sh))

    if any(k.startswith("lora_te1") or "input_blocks" in k for k in keys):
        return "sd15", "SD 1.5 / SDXL keys"
    if any("double_stream_modulation" in k for k in keys) or 6144 in in_dims:
        return "flux2_dev", "Flux.2 Dev keys (6144-d)"
    if any("transformer_blocks" in k and "img_in" not in k for k in keys) and any(
        "qwen" in k.lower() for k in keys
    ):
        return "qwen", "Qwen keys"
    if any("minimax" in k.lower() or "h3" in k.lower() for k in keys):
        return "h3", "MiniMax H3 keys"

    if 4096 in in_dims:
        return "klein9b", "hidden size 4096 (Klein 9B)"

    # LoKr reconstructs as kronecker of w1 x w2. Klein 9B qkv is 12288 x 4096.
    for k, sh in lokr_out:
        if 4096 in sh or sh == (1024, 1024) or sh == (3072, 1024):
            return "klein9b", "LoKr weights are Klein 9B (4096-d)"

    if max_double >= 5 and 3072 in in_dims:
        return "flux1", "Flux.1 LoRA (blocks beyond Klein 4B)"
    if max_double >= 8 or max_single >= 24:
        return "klein9b", "too many blocks for Klein 4B"

    if 3072 in in_dims and 0 <= max_double <= 4 and max_single <= 19:
        return "klein4b", "Klein 4B shapes"
    if has_lokr and 0 <= max_double <= 4 and max_single <= 19:
        return "klein4b", "Klein 4B LoKr"

    return "unknown", "unrecognized LoRA layout"


def filter_loras(params):
    """Drop LoRAs that cannot attach to this pack. Mutates params['loras']."""
    graph = params.get("graph") or ""
    allowed = ALLOWED.get(graph)
    if not allowed:
        return []
    kept = []
    skipped = []
    for item in params.get("loras") or []:
        name = item.get("name")
        if not name or name == "—":
            continue
        path = _lora_path(name)
        if not path:
            kept.append(item)
            continue
        fam, why = classify(path)
        if fam in allowed or (fam == "unknown" and graph in KEEP_UNKNOWN):
            kept.append(item)
            continue
        skipped.append({
            "name": os.path.basename(name),
            "family": fam,
            "label": _LABEL.get(fam, fam),
            "reason": why,
        })
    params["loras"] = kept
    return skipped
