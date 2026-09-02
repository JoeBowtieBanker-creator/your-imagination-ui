"""
graphs.py — ComfyUI API graphs for Your Imagination packs.

Builders take a params dict (resolved filenames, prompt, size, loras, mode)
and return the node graph ComfyUI's POST /prompt expects.
"""

from __future__ import annotations

import os
import random
import re
import time

_STILL_SKIP_LORA = re.compile(
    r"hmmasturb|masturb|finger|cowgirl|pinkfluffy",
    re.I,
)


def _seed(v):
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = -1
    return v if v >= 0 else random.randint(0, 2**31 - 1)


def _i(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _f(v, default):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _mp(p, default=1.77, cap=2.0):
    v = _f((p or {}).get("megapixels"), default)
    return max(0.2, min(cap, v))


def _qwen_fit_size(width, height):
    """Qwen Image Edit native is ~1328². Cap there so 8GB does not OOM."""
    w = max(64, _i(width, 1328))
    h = max(64, _i(height, 1328))
    budget = 1328 * 1328
    pix = max(1, w * h)
    if pix > budget:
        s = (budget / pix) ** 0.5
        w = int(w * s)
        h = int(h * s)
    w = max(64, (w // 16) * 16)
    h = max(64, (h // 16) * 16)
    return w, h


def _h3_fit_size(width, height):
    """Keep H3 sizes on 32px. Hard ceiling ~768p so a request cannot ask for 1080p."""
    w = max(64, _i(width, 960))
    h = max(64, _i(height, 544))
    budget = 1344 * 768
    pix = max(1, w * h)
    if pix > budget:
        s = (budget / pix) ** 0.5
        w = int(w * s)
        h = int(h * s)
    w = max(64, (w // 32) * 32)
    h = max(64, (h // 32) * 32)
    return w, h


def _h3_length(seconds):
    sec = min(15.0, max(1.0, _f(seconds, 5)))
    n = max(5, int(round(sec * 24)))
    while n % 17 != 5:
        n += 1
    return n


def _out_prefix():
    """Unique prefix so Comfy does not overwrite the previous still/clip."""
    return "YourImagination_%d" % (int(time.time() * 1000) % 10000000000)


def _h3_is_still(p):
    return (p.get("mode") or "").lower() in ("t2i", "i2i", "edit")


def _h3_ref_names(p):
    names = []
    for item in p.get("ref_images") or []:
        if isinstance(item, dict):
            name = item.get("name") or item.get("image") or ""
        else:
            name = item
        name = str(name or "").strip()
        if name:
            names.append(name)
    return names


def _h3_use_r2v(p):
    refs = _h3_ref_names(p)
    path = (p.get("h3_path") or "").lower()
    if path in ("i2v", "i2va", "fl2v", "fl2va", "t2v", "t2va"):
        return False
    if path in ("r2v", "r2va", "ref"):
        return True
    if not refs:
        return False
    if _h3_is_still(p) and p.get("ref_unet"):
        return True
    return not p.get("init_image") and not p.get("last_image")


def _loras(p):
    h3 = (p.get("family") or p.get("graph") or "") == "h3"
    still = h3 and (_h3_is_still(p) or bool(p.get("film_still")))
    out = []
    for item in p.get("loras") or []:
        name = item.get("name")
        if not name or name == "—":
            continue
        if still and _STILL_SKIP_LORA.search(str(name)):
            continue
        out.append({
            "name": name,
            "strength": _f(item.get("strength", 1.0), 1.0),
            "model_only": bool(item.get("model_only", False)),
        })
    return out


def _chain_loras(g, loras, model_ref, clip_ref, nid, model_only=False):
    for lora in loras:
        sid = str(nid)
        nid += 1
        if model_only or lora.get("model_only") or clip_ref is None:
            g[sid] = {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {
                    "lora_name": lora["name"],
                    "strength_model": lora["strength"],
                    "model": model_ref,
                },
            }
            model_ref = [sid, 0]
        else:
            g[sid] = {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": lora["name"],
                    "strength_model": lora["strength"],
                    "strength_clip": lora["strength"],
                    "model": model_ref,
                    "clip": clip_ref,
                },
            }
            model_ref = [sid, 0]
            clip_ref = [sid, 1]
    return model_ref, clip_ref, nid


def _load_image(g, name, nid="10"):
    g[nid] = {"class_type": "LoadImage", "inputs": {"image": name}}
    return [nid, 0]


# ---------------------------------------------------------------------------
# Qwen Image Edit 2511
# ---------------------------------------------------------------------------
def build_qwen_edit(p):
    g = {}
    g["1"] = {
        "class_type": "UNETLoader",
        "inputs": {"unet_name": p["unet"], "weight_dtype": "default"},
    }
    g["2"] = {
        "class_type": "CLIPLoader",
        "inputs": {"clip_name": p["clip"], "type": p.get("clip_type") or "qwen_image"},
    }
    g["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": p["vae"]}}
    model_ref, clip_ref = ["1", 0], ["2", 0]
    model_ref, clip_ref, _ = _chain_loras(g, _loras(p), model_ref, clip_ref, 50)

    g["20"] = {
        "class_type": "ModelSamplingAuraFlow",
        "inputs": {"model": model_ref, "shift": _f(p.get("shift", 3.1), 3.1)},
    }
    g["21"] = {
        "class_type": "CFGNorm",
        "inputs": {"model": ["20", 0], "strength": 1.0, "pre_cfg": False},
    }
    model_ref = ["21", 0]

    init = p.get("init_image")
    img_ref = _load_image(g, init) if init else None
    if img_ref:
        # Encode at most ~1.77MP (Qwen native). The UI caps MP to the source
        # so small photos are not upscaled (that invents pores / texture).
        g["12"] = {
            "class_type": "ImageScaleToTotalPixels",
            "inputs": {
                "image": img_ref,
                "upscale_method": "bicubic",
                "megapixels": _mp(p, 1.77),
                "resolution_steps": 16,
            },
        }
        img_ref = ["12", 0]
    pos_in = {
        "clip": clip_ref,
        "prompt": p.get("prompt", ""),
        "vae": ["3", 0],
    }
    if img_ref:
        pos_in["image1"] = img_ref
    g["6"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": pos_in}
    g["7"] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "inputs": {"clip": clip_ref, "prompt": p.get("neg", " "), "vae": ["3", 0]},
    }

    if img_ref:
        g["11"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": img_ref, "vae": ["3", 0]},
        }
        latent = ["11", 0]
        # Qwen Edit is instruction-conditioned. Denoise below ~0.9 copies the photo.
        denoise = 1.0
    else:
        w, h = _qwen_fit_size(p.get("width"), p.get("height"))
        g["5"] = {
            "class_type": "EmptySD3LatentImage",
            "inputs": {
                "width": w,
                "height": h,
                "batch_size": 1,
            },
        }
        latent = ["5", 0]
        denoise = 1.0

    g["30"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": _seed(p.get("seed", -1)),
            "steps": _i(p.get("steps"), 20),
            "cfg": _f(p.get("cfg"), 2.2),
            "sampler_name": p.get("sampler") or "euler",
            "scheduler": p.get("scheduler") or "simple",
            "denoise": denoise,
            "model": model_ref,
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": latent,
        },
    }
    g["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["30", 0], "vae": ["3", 0]}}
    g["9"] = {"class_type": "SaveImage", "inputs": {"filename_prefix": _out_prefix(), "images": ["8", 0]}}
    return g


# ---------------------------------------------------------------------------
# MiniMax H3 (FL2VA / optional Ref2VA)
# ---------------------------------------------------------------------------
def build_h3(p):
    still = _h3_is_still(p)
    use_r2v = _h3_use_r2v(p)
    if use_r2v:
        refs = _h3_ref_names(p)
        if not refs:
            raise ValueError("Reference jobs need at least one reference image.")
        if not p.get("ref_unet"):
            raise ValueError(
                "Reference stills need the Ref2VA weights. Without them the faces are invented."
            )
    unet = p.get("ref_unet") if use_r2v and p.get("ref_unet") else p["unet"]

    g = {}
    g["1"] = {
        "class_type": "UNETLoader",
        "inputs": {"unet_name": unet, "weight_dtype": "default"},
    }
    g["2"] = {
        "class_type": "CLIPLoader",
        "inputs": {"clip_name": p["clip"], "type": "minimax"},
    }
    g["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": p["vae"]}}
    model_ref, clip_ref = ["1", 0], ["2", 0]
    model_ref, clip_ref, _ = _chain_loras(g, _loras(p), model_ref, clip_ref, 50, model_only=True)

    g["20"] = {
        "class_type": "MiniMaxH3SigmaShift",
        "inputs": {"model": model_ref, "shift_video": 12.0, "shift_audio": 3.0},
    }
    model_ref = ["20", 0]

    audio_vae = p.get("audio_vae")
    if audio_vae and (use_r2v or not still):
        g["4"] = {"class_type": "VAELoader", "inputs": {"vae_name": audio_vae}}

    w, h = _h3_fit_size(p.get("width"), p.get("height"))
    # 5-frame clip is H3's shortest latent; we keep frame 0 as the still.
    length = 5 if still else _h3_length(p.get("duration", 5))
    if use_r2v:
        if not audio_vae:
            raise ValueError("H3 reference-to-video needs the audio VAE.")
        cond_in = {
            "clip": clip_ref,
            "vae": ["3", 0],
            "audio_vae": ["4", 0],
            "prompt": p.get("prompt", ""),
            "width": w,
            "height": h,
            "length": length,
            "ref_image_size": "max",
        }
        for i, name in enumerate(_h3_ref_names(p)[:9]):
            cond_in["ref_images.ref_image_%d" % i] = _load_image(g, name, nid=str(70 + i))
        g["12"] = {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": cond_in}
    else:
        cond_in = {
            "clip": clip_ref,
            "vae": ["3", 0],
            "prompt": p.get("prompt", ""),
            "width": w,
            "height": h,
            "length": length,
        }
        init = p.get("init_image")
        last = p.get("last_image")
        if init:
            cond_in["first_frame"] = _load_image(g, init, nid="15")
        if last:
            cond_in["last_frame"] = _load_image(g, last, nid="16")
        g["12"] = {"class_type": "MiniMaxH3ImageToVideo", "inputs": cond_in}
    g["7"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": p.get("neg", ""), "clip": clip_ref},
    }

    steps = _i(p.get("steps"), 20 if still else 8)
    if still and steps < 12:
        steps = 20
    g["30"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": _seed(p.get("seed", -1)),
            "steps": steps,
            "cfg": _f(p.get("cfg"), 1.0),
            "sampler_name": p.get("sampler") or "euler",
            "scheduler": p.get("scheduler") or "simple",
            "denoise": 1.0,
            "model": model_ref,
            "positive": ["12", 0],
            "negative": ["7", 0],
            "latent_image": ["12", 1],
        },
    }
    g["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["30", 0], "vae": ["3", 0]}}
    if still:
        g["18"] = {
            "class_type": "ImageFromBatch",
            "inputs": {"image": ["8", 0], "batch_index": 0, "length": 1},
        }
        g["9"] = {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": _out_prefix(), "images": ["18", 0]},
        }
        return g
    fps = _f(p.get("fps"), 24)
    if audio_vae:
        g["10"] = {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["30", 0], "vae": ["4", 0]},
        }
        g["11"] = {
            "class_type": "CreateVideo",
            "inputs": {"images": ["8", 0], "fps": fps, "audio": ["10", 0]},
        }
        g["9"] = {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["11", 0],
                "filename_prefix": _out_prefix(),
                "format": "mp4",
                "codec": "auto",
            },
        }
    else:
        g["9"] = {
            "class_type": "SaveWEBM",
            "inputs": {
                "images": ["8", 0],
                "filename_prefix": _out_prefix(),
                "codec": "vp9",
                "fps": fps,
                "crf": 28.0,
            },
        }
    return g


# ---------------------------------------------------------------------------
# Flux 2 Klein
# ---------------------------------------------------------------------------
def _klein_is_base(p):
    name = (p.get("unet") or "").lower().replace("\\", "/")
    return "base" in os.path.basename(name)


def build_flux2_klein(p):
    vae_name = (p.get("vae") or "")
    vae_l = vae_name.lower().replace("\\", "/")
    if "flux2-vae" not in vae_l and "flux-2-vae" not in vae_l and "flux2_vae" not in vae_l:
        raise ValueError(
            "Flux 2 Klein needs flux2-vae.safetensors in models/vae "
            "(128-channel Flux.2 VAE). Flux.1 ae.safetensors will sample, then fail on decode."
        )
    # Distilled Klein is 4 steps / CFG 1. The *base* file is undistilled:
    # 8 steps at CFG 1 produces unrecognizable noise.
    is_base = _klein_is_base(p)
    steps = _i(p.get("steps"), 20 if is_base else 4)
    cfg = _f(p.get("cfg"), 4.0 if is_base else 1.0)
    if is_base:
        if steps < 12:
            steps = 20
        if cfg < 2.0:
            cfg = 4.0

    g = {}
    g["1"] = {
        "class_type": "UNETLoader",
        "inputs": {"unet_name": p["unet"], "weight_dtype": "default"},
    }
    g["2"] = {
        "class_type": "CLIPLoader",
        "inputs": {"clip_name": p["clip"], "type": p.get("clip_type") or "flux2"},
    }
    g["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": p["vae"]}}
    model_ref, clip_ref = ["1", 0], ["2", 0]
    model_ref, clip_ref, _ = _chain_loras(g, _loras(p), model_ref, clip_ref, 50)

    g["6"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": p.get("prompt", ""), "clip": clip_ref},
    }
    g["7"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": p.get("neg", ""), "clip": clip_ref},
    }
    pos = ["6", 0]
    neg = ["7", 0]
    if not is_base:
        g["25"] = {
            "class_type": "FluxGuidance",
            "inputs": {"guidance": 1.0, "conditioning": ["6", 0]},
        }
        pos = ["25", 0]
        cfg = 1.0

    init = p.get("init_image")
    if init:
        # Klein is an edit model: the photo goes on conditioning via ReferenceLatent.
        # Sampling still starts from EmptyFlux2Latent. VAEEncode-as-latent + denoise 1
        # (the old path) throws the photo away and invents a new still.
        img = _load_image(g, init)
        g["12"] = {
            "class_type": "ImageScaleToTotalPixels",
            "inputs": {
                "image": img,
                "upscale_method": "lanczos",
                "megapixels": _mp(p, 1.77),
                "resolution_steps": 16,
            },
        }
        g["13"] = {"class_type": "GetImageSize", "inputs": {"image": ["12", 0]}}
        g["11"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["12", 0], "vae": ["3", 0]}}
        g["26"] = {
            "class_type": "ReferenceLatent",
            "inputs": {"conditioning": pos, "latent": ["11", 0]},
        }
        g["27"] = {
            "class_type": "ReferenceLatent",
            "inputs": {"conditioning": neg, "latent": ["11", 0]},
        }
        pos, neg = ["26", 0], ["27", 0]
        g["5"] = {
            "class_type": "EmptyFlux2LatentImage",
            "inputs": {
                "width": ["13", 0],
                "height": ["13", 1],
                "batch_size": 1,
            },
        }
        latent = ["5", 0]
        denoise = 1.0
    else:
        g["5"] = {
            "class_type": "EmptyFlux2LatentImage",
            "inputs": {
                "width": _i(p.get("width"), 1024),
                "height": _i(p.get("height"), 1024),
                "batch_size": 1,
            },
        }
        latent = ["5", 0]
        denoise = 1.0

    g["30"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": _seed(p.get("seed", -1)),
            "steps": steps,
            "cfg": cfg,
            "sampler_name": p.get("sampler") or "euler",
            "scheduler": p.get("scheduler") or "simple",
            "denoise": denoise,
            "model": model_ref,
            "positive": pos,
            "negative": neg,
            "latent_image": latent,
        },
    }
    g["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["30", 0], "vae": ["3", 0]}}
    g["9"] = {"class_type": "SaveImage", "inputs": {"filename_prefix": _out_prefix(), "images": ["8", 0]}}
    return g


# ---------------------------------------------------------------------------
# Z-Image Turbo
# ---------------------------------------------------------------------------
def build_zimage(p):
    g = {}
    g["1"] = {
        "class_type": "UNETLoader",
        "inputs": {"unet_name": p["unet"], "weight_dtype": "default"},
    }
    g["2"] = {
        "class_type": "CLIPLoader",
        "inputs": {"clip_name": p["clip"], "type": p.get("clip_type") or "lumina2"},
    }
    g["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": p["vae"]}}
    model_ref, clip_ref = ["1", 0], ["2", 0]
    model_ref, clip_ref, _ = _chain_loras(g, _loras(p), model_ref, clip_ref, 50)

    g["6"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": p.get("prompt", ""), "clip": clip_ref},
    }
    g["7"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["6", 0]}}

    init = p.get("init_image")
    if p.get("mode") == "i2i" and init:
        img = _load_image(g, init)
        g["12"] = {
            "class_type": "ImageScaleToTotalPixels",
            "inputs": {
                "image": img,
                "upscale_method": "bicubic",
                "megapixels": _mp(p, 1.77),
                "resolution_steps": 16,
            },
        }
        g["11"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["12", 0], "vae": ["3", 0]}}
        latent = ["11", 0]
        denoise = _f(p.get("denoise", 0.85), 0.85)
    else:
        g["5"] = {
            "class_type": "EmptySD3LatentImage",
            "inputs": {
                "width": _i(p.get("width"), 1024),
                "height": _i(p.get("height"), 1024),
                "batch_size": 1,
            },
        }
        latent = ["5", 0]
        denoise = 1.0

    g["30"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": _seed(p.get("seed", -1)),
            "steps": _i(p.get("steps"), 8),
            "cfg": _f(p.get("cfg"), 1.0),
            "sampler_name": p.get("sampler") or "euler",
            "scheduler": p.get("scheduler") or "simple",
            "denoise": denoise,
            "model": model_ref,
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": latent,
        },
    }
    g["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["30", 0], "vae": ["3", 0]}}
    g["9"] = {"class_type": "SaveImage", "inputs": {"filename_prefix": _out_prefix(), "images": ["8", 0]}}
    return g


# ---------------------------------------------------------------------------
# LTX-2.3 (best-effort native nodes)
# ---------------------------------------------------------------------------
def build_ltx(p):
    g = {}
    ckpt = p.get("unet") or p.get("ckpt")
    g["4"] = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}}
    model_ref, clip_ref, vae_ref = ["4", 0], ["4", 1], ["4", 2]
    if p.get("clip"):
        g["2"] = {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": p["clip"], "type": "ltxv"},
        }
        clip_ref = ["2", 0]
    if p.get("vae"):
        g["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": p["vae"]}}
        vae_ref = ["3", 0]
    model_ref, clip_ref, _ = _chain_loras(g, _loras(p), model_ref, clip_ref, 50, model_only=True)

    g["6"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": p.get("prompt", ""), "clip": clip_ref},
    }
    g["7"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": p.get("neg", ""), "clip": clip_ref},
    }
    fps = _f(p.get("fps"), 24)
    g["13"] = {
        "class_type": "LTXVConditioning",
        "inputs": {"positive": ["6", 0], "negative": ["7", 0], "frame_rate": fps},
    }

    w = _i(p.get("width"), 768)
    h = _i(p.get("height"), 512)
    length = max(9, int(round(_f(p.get("duration"), 5) * fps)))
    if (length - 1) % 8:
        length += 8 - ((length - 1) % 8)

    init = p.get("init_image")
    if init:
        img = _load_image(g, init)
        g["12"] = {
            "class_type": "LTXVImgToVideo",
            "inputs": {
                "positive": ["13", 0],
                "negative": ["13", 1],
                "vae": vae_ref,
                "image": img,
                "width": w,
                "height": h,
                "length": length,
                "batch_size": 1,
                "strength": 1.0,
            },
        }
        pos, neg, latent = ["12", 0], ["12", 1], ["12", 2]
    else:
        g["5"] = {
            "class_type": "EmptyLTXVLatentVideo",
            "inputs": {
                "width": w,
                "height": h,
                "length": length,
                "batch_size": 1,
            },
        }
        pos, neg, latent = ["13", 0], ["13", 1], ["5", 0]

    g["30"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": _seed(p.get("seed", -1)),
            "steps": _i(p.get("steps"), 8),
            "cfg": _f(p.get("cfg"), 1.0),
            "sampler_name": p.get("sampler") or "euler",
            "scheduler": p.get("scheduler") or "simple",
            "denoise": 1.0,
            "model": model_ref,
            "positive": pos,
            "negative": neg,
            "latent_image": latent,
        },
    }
    g["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["30", 0], "vae": vae_ref}}
    g["9"] = {
        "class_type": "SaveWEBM",
        "inputs": {
            "images": ["8", 0],
            "filename_prefix": _out_prefix(),
            "codec": "vp9",
            "fps": fps,
            "crf": 28.0,
        },
    }
    return g


BUILDERS = {
    "qwen_edit": build_qwen_edit,
    "h3": build_h3,
    "flux2_klein": build_flux2_klein,
    "zimage": build_zimage,
    "ltx": build_ltx,
}


def build(params):
    graph_id = params.get("graph") or params.get("family") or "qwen_edit"
    fn = BUILDERS.get(graph_id)
    if not fn:
        raise ValueError(f"Unknown pack graph: {graph_id}")
    # map resolved slots onto expected keys
    r = params.get("resolved") or {}
    merged = dict(params)
    for k in ("unet", "clip", "vae", "audio_vae"):
        if r.get(k) and not merged.get(k):
            merged[k] = r[k]
    if not merged.get("unet"):
        raise KeyError("unet")
    return fn(merged)
