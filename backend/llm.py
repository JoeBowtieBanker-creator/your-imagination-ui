"""
llm.py — local CPU prompt rewriter (llama.cpp).

✦ can draft MiniMax fields on the CPU so H3 sampling keeps the GPU.
Does not load during generate. Missing weights or a failed run fall back
to recipes.py Structure.
"""

from __future__ import annotations

import gc
import os
import re
import threading

import recipes

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, ".."))

STRUCTURE_ID = "structure"
STRUCTURE_LABEL = "Structure (built-in)"

_SKIP_NAME = re.compile(
    r"qwen_?2\.?5_?vl_?7b|qwen2\.5-vl-7b|72b|70b|32b|27b|14b-vl",
    re.I,
)
_LABELS = (
    (re.compile(r"qwen2\.5-7b|qwen2_5_7b|qwen2\.5_7b", re.I), "Qwen2.5 7B (local CPU)"),
    (re.compile(r"qwen2\.5-3b|qwen2_5_3b|qwen2\.5_3b", re.I), "Qwen2.5 3B (local CPU)"),
    (re.compile(r"qwen2\.5-1\.5b|qwen2_5_1.?5b", re.I), "Qwen2.5 1.5B (local CPU)"),
    (re.compile(r"llama-3\.1-8b|llama3\.1-8b|llama_3\.1_8b|meta-llama-3\.1-8b", re.I), "Llama 3.1 8B (local CPU)"),
    (re.compile(r"llama-3\.2-3b|llama3\.2-3b|llama_3\.2_3b", re.I), "Llama 3.2 3B (local CPU)"),
    (re.compile(r"mistral-7b-instruct-v0\.3|mistral-7b.*v0\.3", re.I), "Mistral 7B v0.3 (local CPU)"),
)

_SYSTEM = """You rewrite shot notes into MiniMax H3 labeled fields. Output ONLY these lines, nothing else:

integrated_multimodal_description: <visual shot and camera only>
dialogue: <spoken words only, or none>
overall_soundscape: <diegetic sounds only>
non_diegetic_music: N/A

Rules:
- Keep the user's action, setting, and people. Do not invent a new scene.
- Visuals, sex, bodies, wardrobe, and camera stay in integrated_multimodal_description.
- Never put the shot or visual sex into dialogue.
- dialogue is only words someone speaks, or none. Quote spoken lines. Write none if silent.
- overall_soundscape is sounds only (bed, fan, breath, radio). No visuals and no speech.
- non_diegetic_music is N/A unless the user asked for a score.
- Keep each named person's sex. Write matching adult anatomy. Do not use invert phrasing such as "no penis on the woman" or "no vagina on the man".
- No markdown. No commentary."""

_loaded = {"id": None, "llm": None}
_lock = threading.Lock()

_RAM_HINTS = (
    "out of memory",
    "failed to allocate",
    "bad_alloc",
    "not enough memory",
    "cannot allocate",
    "memoryerror",
    "std::bad_alloc",
    "mmap failed",
    "failed to mmap",
)

_FIELD_LINE = re.compile(
    r"^\s*(?:\*\*|__|#+\s*)?\s*"
    r"(integrated[_\s-]*multimodal[_\s-]*description|shot|visuals?|"
    r"dialogue|spoken[_\s-]*dialogue|spoken|"
    r"overall[_\s-]*soundscape|soundscape|"
    r"non[_\s-]*diegetic[_\s-]*music|music)"
    r"(?:\b[^:]{0,80})?"
    r"\s*(?:\*\*|__)?\s*:\s*(.*)$",
    re.I,
)

_ID_ALIASES = (
    (re.compile(r"^(qwen2?\.?5?-?3b|qwen-?3b)$", re.I), "qwen2.5-3b"),
    (re.compile(r"^(qwen2?\.?5?-?7b|qwen-?7b)$", re.I), "qwen2.5-7b"),
    (re.compile(r"^(llama-?3\.?1-?8b|llama-?8b|llama3\.1)$", re.I), "llama-3.1-8b"),
    (re.compile(r"^(llama-?3\.?2-?3b|llama-?3b|llama3\.2)$", re.I), "llama-3.2-3b"),
    (re.compile(r"^(mistral-?7b(?:-instruct)?(?:-v0\.3)?|mistral)$", re.I), "mistral-7b"),
)


def search_dirs():
    dirs = []
    env = os.environ.get("YI_LLM_DIR")
    if env:
        dirs.append(os.path.abspath(env))
    dirs.append(os.path.join(PROJECT, "models", "llm"))
    try:
        import packs
        root = packs.detect_models_root()
        if root:
            dirs.append(os.path.join(root, "LLM"))
            dirs.append(os.path.join(root, "llm"))
    except Exception:
        pass
    comfy = os.path.abspath(os.path.join(PROJECT, "..", "ComfyUI_windows_portable", "ComfyUI", "models"))
    dirs.append(os.path.join(comfy, "LLM"))
    dirs.append(os.path.join(comfy, "llm"))
    out = []
    seen = set()
    for d in dirs:
        d = os.path.abspath(d)
        key = d.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def _label_for(name):
    for rx, label in _LABELS:
        if rx.search(name):
            return label
    stem = os.path.splitext(name)[0]
    return stem + " (local CPU)"


def _model_id(name):
    stem = os.path.splitext(name)[0]
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip("-").lower()
    return safe or "local-gguf"


def list_ggufs():
    found = []
    seen_id = set()
    seen_path = set()
    for folder in search_dirs():
        if not os.path.isdir(folder):
            continue
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for name in names:
            if not name.lower().endswith(".gguf"):
                continue
            if _SKIP_NAME.search(name):
                continue
            path = os.path.abspath(os.path.join(folder, name))
            key = path.lower()
            if key in seen_path:
                continue
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if size < 8 * 1024 * 1024:
                continue
            mid = _model_id(name)
            if mid in seen_id:
                mid = mid + "-" + str(len(seen_id) + 1)
            seen_path.add(key)
            seen_id.add(mid)
            found.append({
                "id": mid,
                "label": _label_for(name),
                "kind": "llm",
                "filename": name,
                "path": path,
                "available": True,
                "bytes": size,
            })
    found.sort(key=lambda m: (m["label"].lower(), m["filename"].lower()))
    return found


def list_models():
    models = [{
        "id": STRUCTURE_ID,
        "label": STRUCTURE_LABEL,
        "kind": "builtin",
        "available": True,
    }]
    models.extend(list_ggufs())
    return models


def resolve_model(model_id):
    mid = (model_id or "").strip().lower()
    if not mid or mid == STRUCTURE_ID:
        return None
    found = list_ggufs()
    for item in found:
        if item["id"] == mid or item["filename"].lower() == mid or os.path.basename(item["path"]).lower() == mid:
            return item
        if item.get("label", "").lower() == mid:
            return item
    compact = re.sub(r"[^a-z0-9]+", "", mid)
    hint = mid
    for rx, token in _ID_ALIASES:
        if rx.search(mid) or rx.search(compact):
            hint = token
            break
    hint_compact = re.sub(r"[^a-z0-9]+", "", hint)
    matches = []
    for item in found:
        blob = (item["id"] + " " + item.get("label", "") + " " + item["filename"]).lower()
        blob_c = re.sub(r"[^a-z0-9]+", "", blob)
        if hint in blob or (hint_compact and hint_compact in blob_c):
            matches.append(item)
    if len(matches) == 1:
        return matches[0]
    return None


def engine_name():
    try:
        import llama_cpp  # noqa: F401
        return "llama-cpp-python"
    except Exception:
        return "missing"


def is_ram_error(exc):
    if isinstance(exc, MemoryError):
        return True
    msg = str(exc or "").lower()
    return any(h in msg for h in _RAM_HINTS)


def friendly_error(exc):
    if is_ram_error(exc):
        return "Not enough RAM to load this model. Try a 3B model."
    msg = str(exc or "").strip() or "Local model failed."
    return msg


def _chat_format_for(path):
    name = os.path.basename(path or "").lower()
    if "mistral" in name:
        return "mistral-instruct"
    return None


def _unload_locked():
    llm = _loaded.get("llm")
    _loaded["llm"] = None
    _loaded["id"] = None
    if llm is None:
        return
    try:
        closer = getattr(llm, "close", None)
        if closer:
            closer()
    except Exception:
        pass
    try:
        del llm
    except Exception:
        pass
    gc.collect()


def _get_llm(path):
    from llama_cpp import Llama

    path = os.path.normpath(os.path.abspath(path))
    with _lock:
        if _loaded["llm"] is not None and _loaded["id"] == path:
            return _loaded["llm"]
        _unload_locked()
        threads = max(2, min(6, (os.cpu_count() or 4) - 1))
        kwargs = {
            "model_path": path,
            "n_ctx": 2048,
            "n_gpu_layers": 0,
            "n_threads": threads,
            "n_batch": 256,
            "verbose": False,
        }
        fmt = _chat_format_for(path)
        try:
            if fmt:
                try:
                    llm = Llama(chat_format=fmt, **kwargs)
                except (TypeError, ValueError, KeyError):
                    llm = Llama(**kwargs)
            else:
                llm = Llama(**kwargs)
        except Exception as e:
            _unload_locked()
            if is_ram_error(e):
                raise RuntimeError("Not enough RAM to load this model. Try a 3B model.") from e
            raise RuntimeError("Could not load local model: " + friendly_error(e)[:180]) from e
        _loaded["id"] = path
        _loaded["llm"] = llm
        return llm


def _user_block(shot, dialogue, soundscape, music=""):
    shot = (shot or "").strip()
    dialogue = (dialogue or "").strip() or "none"
    soundscape = (soundscape or "").strip() or "(none given)"
    music = (music or "").strip()
    lines = [
        "Shot (visual / camera only):",
        shot or "(none)",
        "",
        "Dialogue (spoken words only, or none):",
        dialogue,
        "",
        "Soundscape (diegetic sounds only):",
        soundscape,
    ]
    if music and music.lower() not in ("n/a", "na", "none"):
        lines.extend(["", "Music (only if the user asked):", music])
    lines.append("")
    lines.append("Rewrite into these four labeled fields, using these exact keys:")
    lines.append("integrated_multimodal_description:")
    lines.append("dialogue:")
    lines.append("overall_soundscape:")
    lines.append("non_diegetic_music:")
    return "\n".join(lines)


def _strip_fences(text):
    t = (text or "").strip()
    t = re.sub(r"^```(?:\w+)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    return t.strip()


def _canon_field_key(raw):
    k = re.sub(r"[^a-z0-9]+", "_", (raw or "").lower()).strip("_")
    if k.startswith("integrated") or k in ("shot", "visual", "visuals"):
        return "integrated_multimodal_description"
    if k in ("dialogue", "spoken_dialogue", "spoken"):
        return "dialogue"
    if k in ("overall_soundscape", "soundscape"):
        return "overall_soundscape"
    if k in ("non_diegetic_music", "music"):
        return "non_diegetic_music"
    return None


def _normalize_model_text(text):
    lines = []
    found = False
    for raw in (text or "").splitlines():
        m = _FIELD_LINE.match(raw.strip())
        if m:
            key = _canon_field_key(m.group(1))
            if key:
                lines.append(key + ": " + (m.group(2) or "").strip())
                found = True
                continue
        lines.append(raw)
    return "\n".join(lines), found


def parse_fields(text):
    raw = _strip_fences(text)
    raw, found = _normalize_model_text(raw)
    if "integrated_multimodal_description" not in raw.lower():
        m = re.search(r"(integrated_multimodal_description\s*:)", raw, re.I)
        if not m and not found:
            return None
        if m:
            raw = raw[m.start():]
    fields = recipes._h3_field_map(raw)
    shot = (fields.get("integrated_multimodal_description") or "").strip()
    if not shot:
        return None
    spoken = recipes._sanitize_spoken(fields.get("dialogue") or fields.get("spoken_dialogue") or "")
    soundscape = recipes._sanitize_soundscape(fields.get("overall_soundscape") or "")
    music = recipes._sanitize_music(fields.get("non_diegetic_music") or "")
    return {
        "shot": recipes._clean(shot),
        "dialogue": spoken,
        "soundscape": soundscape,
        "music": music,
    }


def format_fields(parsed):
    spoken = parsed.get("dialogue")
    dialogue_line = f'"{spoken}"' if spoken else "none"
    music = parsed.get("music") or "N/A"
    return recipes._h3_pack(
        "",
        parsed.get("shot") or "",
        parsed.get("soundscape") or "",
        dialogue_line,
        music,
        want_audio=True,
        user_sound=bool(parsed.get("soundscape")),
        spoken=spoken,
    )


def rewrite_text(shot, dialogue="", soundscape="", music="", model_id=""):
    item = resolve_model(model_id)
    if item is None:
        raise RuntimeError("Local prompt model not found.")
    if engine_name() == "missing":
        raise RuntimeError("llama-cpp-python is not installed.")
    user = _user_block(shot, dialogue, soundscape, music)
    llm = _get_llm(item["path"])
    mistral = "mistral" in item["filename"].lower()
    if mistral:
        messages = [{"role": "user", "content": _SYSTEM + "\n\n" + user}]
    else:
        messages = [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user},
        ]
    with _lock:
        out = llm.create_chat_completion(
            messages=messages,
            temperature=0.2,
            max_tokens=512,
        )
    text = ""
    try:
        text = out["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        text = ""
    parsed = parse_fields(text)
    if not parsed and mistral:
        prompt = "[INST] " + _SYSTEM + "\n\n" + user + " [/INST]"
        with _lock:
            raw_out = llm.create_completion(
                prompt=prompt, temperature=0.2, max_tokens=512, stop=["</s>", "[INST]"],
            )
        try:
            text = raw_out["choices"][0]["text"]
        except (KeyError, IndexError, TypeError):
            text = text or ""
        parsed = parse_fields(text)
    if not parsed:
        raise RuntimeError("Local model returned unstructured text.")
    return format_fields(parsed)
