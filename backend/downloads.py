"""Recommended pack assets and background Hugging Face downloads."""

from __future__ import annotations

import os
import threading
import time
import uuid

import requests

import packs

HF = "https://huggingface.co"

# Official / Comfy-Org split files. Klein 9B and Flux.1 anatomy are never listed.
CATALOG = {
    "flux2-klein": [
        {
            "id": "unet",
            "label": "Klein 4B Base UNet (FP8)",
            "kind": "required",
            "slot": "unet",
            "folder": "diffusion_models",
            "filename": "flux-2-klein-base-4b-fp8.safetensors",
            "patterns": ["flux-2-klein-base-4b*", "flux-2-klein-4b*", "flux2*klein*4b*"],
            "url": f"{HF}/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/diffusion_models/flux-2-klein-base-4b.safetensors",
            "note": "Quality path (~20 steps). Distilled 4-step also satisfies this slot.",
        },
        {
            "id": "unet_distilled",
            "label": "Klein 4B Distilled UNet (FP8, 4-step)",
            "kind": "recommended",
            "slot": "unet",
            "folder": "diffusion_models",
            "filename": "flux-2-klein-4b.safetensors",
            "patterns": ["flux-2-klein-4b.safetensors", "flux-2-klein-4b-fp8*"],
            "url": f"{HF}/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/diffusion_models/flux-2-klein-4b.safetensors",
            "note": "4-step distilled (~7.8GB). Optional if you already have Base. The public Comfy-Org file is not FP8.",
        },
        {
            "id": "clip",
            "label": "Qwen 3 4B text encoder",
            "kind": "required",
            "slot": "clip",
            "folder": "text_encoders",
            "filename": "qwen_3_4b.safetensors",
            "patterns": ["qwen_3_4b*", "qwen3-4b*", "qwen3_4b*"],
            "url": f"{HF}/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
        },
        {
            "id": "vae",
            "label": "Flux 2 VAE",
            "kind": "required",
            "slot": "vae",
            "folder": "vae",
            "filename": "flux2-vae.safetensors",
            "patterns": ["flux2-vae*", "flux-2-vae*", "flux2_vae*"],
            "url": f"{HF}/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/vae/flux2-vae.safetensors",
        },
        {
            "id": "clip_heretic",
            "label": "Uncensored CLIP (optional, NSFW Klein)",
            "kind": "nsfw",
            "slot": "clip",
            "folder": "text_encoders",
            "filename": "qwen3-4b-heretic_fp8_e4m3fn.safetensors",
            "patterns": ["qwen3-4b-heretic*", "*heretic*4b*", "*uncensored*qwen3*4b*"],
            "url": "",
            "note": "Optional. Drop into text_encoders/. Used when the NSFW chip is on.",
        },
        {
            "id": "klein_nsfw_fix",
            "label": "Optional adult LoRA (Klein 4B)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "klein4b_FLUX_NSFW_Fix.safetensors",
            "patterns": ["klein4b_FLUX_NSFW_Fix*", "FLUX_NSFW_Fix*"],
            "url": "",
            "note": "Optional. Drop into loras/. Used when the NSFW chip is on.",
        },
    ],
    "qwen-edit": [
        {
            "id": "unet",
            "label": "Qwen Image Edit 2511 (FP8 mixed)",
            "kind": "required",
            "slot": "unet",
            "folder": "diffusion_models",
            "filename": "qwen_image_edit_2511_fp8mixed.safetensors",
            "patterns": ["qwen_image_edit_2511_fp8mixed*", "qwen_image_edit_2511*", "Qwen-Image-Edit-2511*"],
            "url": f"{HF}/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors",
            "note": "Large file (~20 GB).",
        },
        {
            "id": "clip",
            "label": "Qwen 2.5 VL 7B (FP8)",
            "kind": "required",
            "slot": "clip",
            "folder": "text_encoders",
            "filename": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
            "patterns": ["qwen_2.5_vl_7b_fp8_scaled*", "qwen_2.5_vl_7b*"],
            "url": f"{HF}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
        },
        {
            "id": "vae",
            "label": "Qwen Image VAE",
            "kind": "required",
            "slot": "vae",
            "folder": "vae",
            "filename": "qwen_image_vae.safetensors",
            "patterns": ["qwen_image_vae*"],
            "url": f"{HF}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors",
        },
        {
            "id": "lightning4",
            "label": "Lightning 4-step LoRA",
            "kind": "recommended",
            "slot": "lora",
            "folder": "loras",
            "filename": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
            "patterns": ["Qwen-Image-Edit-2511-Lightning-4steps*"],
            "url": f"{HF}/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
            "note": "Faster, softer anatomy. Off by default.",
        },
        {
            "id": "sexgod",
            "label": "Optional adult LoRA (Qwen Edit)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "SEXGOD_FemaleNudity_QwenEdit_2511.safetensors",
            "patterns": ["SEXGOD_FemaleNudity_QwenEdit_2511*", "SEXGOD*2511*"],
            "url": "",
            "note": "Optional. Drop into loras/. Used when the NSFW chip is on.",
        },
        {
            "id": "unblur",
            "label": "Optional unblur / upscale LoRA",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "Qwen-Image-Edit-Unblur-Upscale.safetensors",
            "patterns": ["Qwen-Image-Edit-Unblur-Upscale*"],
            "url": "",
            "note": "Optional. Drop into loras/. Off by default.",
        },
        {
            "id": "snofs",
            "label": "Optional backup adult LoRA (Qwen Edit)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "Qwen_Snofs.safetensors",
            "patterns": ["Qwen_Snofs*"],
            "url": "",
            "note": "Optional. Drop into loras/. Off if another adult LoRA is already on.",
        },
    ],
    "h3-video": [
        {
            "id": "unet",
            "label": "MiniMax H3 FL2VA pruned INT8",
            "kind": "required",
            "slot": "unet",
            "folder": "diffusion_models",
            "filename": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
            "patterns": ["minimax_h3_fl2va_pruned_int8*", "minimax_h3_fl2va*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
            "note": "Large (~21 GB). First generate can sit at 0% while it pages in.",
        },
        {
            "id": "clip",
            "label": "Qwen3-VL 32B MiniMax H3 (NVFP4)",
            "kind": "required",
            "slot": "clip",
            "folder": "text_encoders",
            "filename": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
            "patterns": ["qwen3vl_32b_minimax_h3_nvfp4*", "qwen3vl_32b_minimax_h3*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        },
        {
            "id": "vae",
            "label": "H3 video VAE",
            "kind": "required",
            "slot": "vae",
            "folder": "vae",
            "filename": "minimax_h3_video_vae_fp16.safetensors",
            "patterns": ["minimax_h3_video_vae*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors",
        },
        {
            "id": "audio_vae",
            "label": "H3 audio VAE",
            "kind": "required",
            "slot": "audio_vae",
            "folder": "vae",
            "filename": "minimax_h3_audio_vae_fp32.safetensors",
            "patterns": ["minimax_h3_audio_vae*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors",
        },
        {
            "id": "turbo8",
            "label": "Turbo 8-step LoRA",
            "kind": "recommended",
            "slot": "lora",
            "folder": "loras",
            "filename": "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
            "patterns": ["minimax_h3_fl2v_turbo_8step*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
        },
        {
            "id": "turbo4",
            "label": "Turbo 4-step LoRA (FL2V)",
            "kind": "recommended",
            "slot": "lora",
            "folder": "loras",
            "filename": "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
            "patterns": ["minimax_h3_fl2v_turbo_4step*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
            "note": "Optional faster FL2V path. Off by default. Official file is now the 768p v1.0.",
        },
        {
            "id": "turbo_ref4",
            "label": "Turbo 4-step LoRA (Ref2V)",
            "kind": "recommended",
            "slot": "lora",
            "folder": "loras",
            "filename": "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
            "patterns": ["minimax_h3_ref2v_turbo_4step*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
            "note": "R2V / Film identity jobs only. Do not stack on FL2V I2V. Off by default.",
        },
        {
            "id": "ref_unet",
            "label": "MiniMax H3 Ref2VA pruned INT8",
            "kind": "recommended",
            "slot": "ref_unet",
            "folder": "diffusion_models",
            "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
            "patterns": ["minimax_h3_ref2va_pruned_int8*", "minimax_h3_ref2va*"],
            "url": f"{HF}/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
            "note": "Identity-locked video from face crops. Film R2V and Ref still.",
        },
        {
            "id": "bunny",
            "label": "Optional adult LoRA (I2V / Film continue)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "PinkFluffyBunny-pruned-fl2va-v1-rank128.safetensors",
            "patterns": ["PinkFluffyBunny-pruned-fl2va*", "PinkFluffyBunny*"],
            "url": "",
            "note": "Optional. Drop into loras/. Used when the NSFW chip is on.",
        },
        {
            "id": "aftermidnight",
            "label": "Optional adult LoRA (R2V / ref stills)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "AfterMidnight_ref2va_h3_sexytime_rank64-v1.2.safetensors",
            "patterns": ["AfterMidnight_ref2va_h3_sexytime*", "AfterMidnight*sexytime*"],
            "url": "",
            "note": "Optional. Drop into loras/. Used when the NSFW chip is on.",
        },
        {
            "id": "realism",
            "label": "Optional realism LoRA (H3)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "h3-realism-people-t2v-i2v-r2v.safetensors",
            "patterns": ["h3-realism-people*", "*MiniMax-H3-Realism*"],
            "url": "",
            "note": "Optional. Drop into loras/. Off by default. Used when the NSFW chip is on.",
        },
        {
            "id": "cowgirl",
            "label": "Optional scene LoRA (cowgirl, per-clip)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "minimax_h3_cowgirl_position_ref2v.safetensors",
            "patterns": ["minimax_h3_cowgirl_position_ref2v*", "*cowgirl*ref2v*"],
            "url": f"{HF}/EllaPriest45/MinimaxH3_Actions/resolve/main/Cowgirl%20Position%20(NSFW)%20REF2V%20R512%20-%20MinimaxH3%20-%20cowgirl%20position.safetensors",
            "note": "Optional per-clip swap. Off by default. Do not stack with Bunny.",
        },
        {
            "id": "fingering",
            "label": "Optional scene LoRA (fingering, per-clip)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "minimax_h3_fingering_fl2v.safetensors",
            "patterns": ["minimax_h3_fingering_fl2v*", "*fingering*fl2v*"],
            "url": "",
            "note": "Optional per-clip swap. Off by default. Drop into loras/. Do not stack with Bunny.",
        },
        {
            "id": "masturbation",
            "label": "Optional scene LoRA (masturbation, per-clip)",
            "kind": "nsfw",
            "slot": "lora",
            "folder": "loras",
            "filename": "minimax_h3_hmmasturbation_fl2v.safetensors",
            "patterns": ["minimax_h3_hmmasturbation_fl2v*", "*hmmasturbation*fl2v*"],
            "url": f"{HF}/kirk86413/masst-h3/resolve/main/HMMasturbationV1.safetensors",
            "note": "Optional per-clip swap. Off by default. Do not stack with Bunny or Fingering.",
        },
    ],
    "z-image-turbo": [
        {
            "id": "unet",
            "label": "Z-Image Turbo (NVFP4)",
            "kind": "required",
            "slot": "unet",
            "folder": "diffusion_models",
            "filename": "z_image_turbo_nvfp4.safetensors",
            "patterns": ["z_image_turbo*", "z-image-turbo*"],
            "url": f"{HF}/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_nvfp4.safetensors",
            "note": "NVFP4 fits RTX 50-series. INT8 / BF16 also count as installed.",
        },
        {
            "id": "clip",
            "label": "Qwen 3 4B text encoder",
            "kind": "required",
            "slot": "clip",
            "folder": "text_encoders",
            "filename": "qwen_3_4b.safetensors",
            "patterns": ["qwen_3_4b*", "qwen3-4b*", "qwen3_4b*"],
            "url": f"{HF}/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
        },
        {
            "id": "vae",
            "label": "Z-Image VAE (ae.safetensors)",
            "kind": "required",
            "slot": "vae",
            "folder": "vae",
            "filename": "ae.safetensors",
            "patterns": ["ae.safetensors"],
            "url": f"{HF}/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
        },
    ],
    "ltx-23": [
        {
            "id": "unet",
            "label": "LTX-2.3 22B Dev FP8",
            "kind": "required",
            "slot": "unet",
            "folder": "checkpoints",
            "filename": "ltx-2.3-22b-dev-fp8.safetensors",
            "patterns": ["ltx-2.3-22b*", "ltx-2.3*"],
            "url": f"{HF}/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-dev-fp8.safetensors",
            "note": "Very large. H3 is the recommended video path on 8GB.",
        },
        {
            "id": "clip",
            "label": "Gemma 3 12B text encoder",
            "kind": "required",
            "slot": "clip",
            "folder": "text_encoders",
            "filename": "gemma_3_12B_it_fp4_mixed.safetensors",
            "patterns": ["gemma_3_12B*", "gemma-3-12b*", "gemma3*12b*"],
            "url": f"{HF}/Comfy-Org/Lightricks_LTX-Video_ComfyUI/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors",
        },
        {
            "id": "vae",
            "label": "LTX video VAE",
            "kind": "required",
            "slot": "vae",
            "folder": "vae",
            "filename": "ltx-2.3-video-vae.safetensors",
            "patterns": ["ltx-2.5-video-vae*", "ltx-2*video*vae*", "LTX2_video_vae*", "taeltx*"],
            "url": f"{HF}/Kijai/LTX2.3_comfy/resolve/main/taeltx2_3.safetensors",
        },
        {
            "id": "distilled",
            "label": "LTX-2.3 distilled LoRA",
            "kind": "recommended",
            "slot": "lora",
            "folder": "loras",
            "filename": "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
            "patterns": ["ltx-2.3-22b-distilled-lora*", "ltx_2.3_22b_distilled*"],
            "url": f"{HF}/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
        },
    ],
}

_lock = threading.Lock()
_jobs = {}
_cancel = {}
_active = 0
_MAX = 2


def _pool_names(scanned, folder):
    files = (scanned or {}).get("files") or {}
    names = list(files.get(folder) or [])
    if folder == "loras":
        names += files.get("Lora") or []
    if folder == "text_encoders":
        names += files.get("clip") or []
    if folder == "diffusion_models":
        names += files.get("unet") or []
        names += files.get("checkpoints") or []
    if folder == "checkpoints":
        names += files.get("diffusion_models") or []
        names += files.get("unet") or []
    return names


def _installed(asset, scanned):
    pool = _pool_names(scanned, asset.get("folder") or "diffusion_models")
    return bool(packs._match_patterns(pool, asset.get("patterns") or [asset.get("filename")]))


def enrich_pack(pack, scanned):
    assets = []
    for raw in CATALOG.get(pack.get("id") or "", []):
        item = dict(raw)
        item["installed"] = _installed(item, scanned)
        item["has_url"] = bool(item.get("url"))
        assets.append(item)
    req = [a for a in assets if a.get("kind") == "required"]
    missing_req = [a for a in req if not a["installed"]]
    missing_all = [a for a in assets if not a["installed"]]
    pack["assets"] = assets
    pack["asset_summary"] = {
        "required": len(req),
        "required_ready": len(req) - len(missing_req),
        "missing": len(missing_all),
        "total": len(assets),
    }
    return pack


def enrich_catalog(catalog):
    scanned = {"files": catalog.get("counts") and {}}
    # rebuild file lists from packs scan — caller should pass scanned files
    return catalog


def attach_assets(catalog, scanned=None):
    if scanned is None:
        scanned = packs.scan_models(catalog.get("models_root"))
    for pack in catalog.get("packs") or []:
        enrich_pack(pack, scanned)
    catalog["download_jobs"] = list_jobs()
    return catalog


def find_asset(pack_id, asset_id):
    for a in CATALOG.get(pack_id) or []:
        if a.get("id") == asset_id:
            return a
    return None


def list_jobs():
    with _lock:
        return [dict(j) for j in _jobs.values()]


def job_snapshot(job_id):
    with _lock:
        j = _jobs.get(job_id)
        return dict(j) if j else None


def cancel_job(job_id):
    with _lock:
        ev = _cancel.get(job_id)
        if ev:
            ev.set()
        j = _jobs.get(job_id)
        if j and j.get("status") in ("queued", "running"):
            j["status"] = "cancelling"
        return dict(j) if j else None


def start_download(pack_id, asset_id, models_root=None):
    asset = find_asset(pack_id, asset_id)
    if not asset:
        raise ValueError("Unknown asset")
    if not asset.get("url"):
        raise ValueError("No download URL for this file. Drop it into " + (asset.get("folder") or "models") + "/")
    root = models_root or packs.detect_models_root()
    if not root or not os.path.isdir(root):
        raise ValueError("Set your ComfyUI models folder first.")
    dest_dir = os.path.join(root, asset["folder"])
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, asset["filename"])
    if os.path.isfile(dest) and os.path.getsize(dest) > 1024:
        return {
            "id": None,
            "status": "done",
            "already": True,
            "dest": dest,
            "pack_id": pack_id,
            "asset_id": asset_id,
            "label": asset["label"],
        }

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "pack_id": pack_id,
        "asset_id": asset_id,
        "label": asset.get("label") or asset_id,
        "filename": asset["filename"],
        "folder": asset["folder"],
        "status": "queued",
        "bytes": 0,
        "total": 0,
        "error": "",
        "dest": dest,
        "started": time.time(),
    }
    ev = threading.Event()
    with _lock:
        _jobs[job_id] = job
        _cancel[job_id] = ev
    t = threading.Thread(target=_run_job, args=(job_id, asset["url"], dest, ev), daemon=True)
    t.start()
    return dict(job)


def _headers():
    h = {"User-Agent": "YourImagination/1.0", "Accept": "*/*"}
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        h["Authorization"] = "Bearer " + token
    return h


def _wait_slot(ev):
    global _active
    while True:
        if ev.is_set():
            return False
        with _lock:
            if _active < _MAX:
                _active += 1
                return True
        time.sleep(0.4)


def _release_slot():
    global _active
    with _lock:
        _active = max(0, _active - 1)


def _set(job_id, **kw):
    with _lock:
        j = _jobs.get(job_id)
        if j:
            j.update(kw)


def _run_job(job_id, url, dest, ev):
    part = dest + ".part"
    if not _wait_slot(ev):
        _set(job_id, status="cancelled", error="Cancelled")
        return
    _set(job_id, status="running")
    try:
        resume = os.path.getsize(part) if os.path.isfile(part) else 0
        headers = _headers()
        if resume:
            headers["Range"] = f"bytes={resume}-"
        with requests.get(url, stream=True, timeout=60, headers=headers, allow_redirects=True) as r:
            if r.status_code == 416:
                resume = 0
            elif r.status_code not in (200, 206):
                raise RuntimeError(f"Download failed ({r.status_code}). {r.text[:180]}")
            total = r.headers.get("Content-Length")
            total = int(total) if total and total.isdigit() else 0
            if r.status_code == 206 and total:
                cr = r.headers.get("Content-Range") or ""
                if "/" in cr:
                    try:
                        total = int(cr.rsplit("/", 1)[-1])
                    except ValueError:
                        pass
            elif r.status_code == 200:
                resume = 0
            if total:
                _set(job_id, total=total + (0 if r.status_code == 200 else 0))
                if r.status_code == 206:
                    _set(job_id, total=total)
                else:
                    _set(job_id, total=total)
            mode = "ab" if resume and r.status_code == 206 else "wb"
            if mode == "wb":
                resume = 0
            got = resume
            _set(job_id, bytes=got)
            with open(part, mode) as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if ev.is_set():
                        _set(job_id, status="cancelled", error="Cancelled")
                        return
                    if not chunk:
                        continue
                    f.write(chunk)
                    got += len(chunk)
                    _set(job_id, bytes=got)
        if ev.is_set():
            _set(job_id, status="cancelled", error="Cancelled")
            return
        if not os.path.isfile(part) or os.path.getsize(part) < 1024:
            raise RuntimeError("Download was empty. The link may require a Hugging Face login.")
        os.replace(part, dest)
        _set(job_id, status="done", bytes=os.path.getsize(dest), total=os.path.getsize(dest))
    except Exception as e:
        _set(job_id, status="error", error=str(e))
    finally:
        _release_slot()
