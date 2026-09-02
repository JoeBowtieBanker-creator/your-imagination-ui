"""Last-frame extract and clip concat for Film mode."""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
import tempfile
import uuid

import library


def _ffmpeg():
    found = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if found:
        return found
    try:
        import imageio_ffmpeg
        path = imageio_ffmpeg.get_ffmpeg_exe()
        if path and os.path.isfile(path):
            return path
    except Exception:
        pass
    roots = []
    exe = sys.executable or ""
    if exe:
        # venv/Scripts/python.exe → venv/Lib/site-packages/imageio_ffmpeg/binaries
        scripts = os.path.dirname(os.path.abspath(exe))
        venv = os.path.dirname(scripts)
        roots.append(os.path.join(venv, "Lib", "site-packages", "imageio_ffmpeg", "binaries"))
    local = os.environ.get("LOCALAPPDATA") or ""
    if local:
        roots.append(os.path.join(
            local, "YourImagination", "venv", "Lib", "site-packages",
            "imageio_ffmpeg", "binaries",
        ))
    here = os.path.dirname(os.path.abspath(__file__))
    roots.append(os.path.join(here, "..", "bin"))
    for root in roots:
        if not os.path.isdir(root):
            continue
        hits = sorted(glob.glob(os.path.join(root, "ffmpeg*.exe"))) + sorted(
            glob.glob(os.path.join(root, "ffmpeg"))
        )
        for hit in hits:
            if os.path.isfile(hit):
                return hit
    return None


def _need_ffmpeg(what):
    path = _ffmpeg()
    if path:
        return path
    raise RuntimeError(
        "ffmpeg is missing for " + what + ". Restart Your Imagination "
        "(not ComfyUI) so it can use the copy in the app environment."
    )


def _run(cmd, timeout=120):
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except TypeError:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)


def extract_last_frame(filename, subfolder="", type_name="output"):
    ffmpeg = _need_ffmpeg("last-frame continue")
    src = library.resolve_media(filename, subfolder, type_name)
    if not os.path.isfile(src):
        raise FileNotFoundError("Video not found: " + filename)
    dest_dir = library.input_root()
    os.makedirs(dest_dir, exist_ok=True)
    name = "yi_last_" + uuid.uuid4().hex[:10] + ".png"
    dest = os.path.join(dest_dir, name)
    attempts = [
        [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
         "-sseof", "-0.12", "-i", src, "-an", "-frames:v", "1", "-q:v", "2", dest],
        [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
         "-sseof", "-1", "-i", src, "-an", "-frames:v", "1", "-q:v", "2", dest],
        # Decode the whole clip; image2 -update leaves the last frame. No ffprobe needed.
        [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
         "-i", src, "-an", "-update", "1", "-q:v", "2", dest],
    ]
    err = ""
    for cmd in attempts:
        if os.path.isfile(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
        r = _run(cmd, timeout=90)
        if r.returncode == 0 and os.path.isfile(dest) and os.path.getsize(dest) > 100:
            return {"ok": True, "name": name, "filename": name, "subfolder": "", "type": "input"}
        err = (r.stderr or b"").decode("utf-8", "ignore")[-400:]
    raise RuntimeError("Could not pull the last frame. " + err)


def extract_frame(filename, subfolder="", type_name="output", time_sec=0):
    """Grab one PNG at a timestamp (seconds) and write it to hub input."""
    ffmpeg = _need_ffmpeg("frame grab")
    src = library.resolve_media(filename, subfolder, type_name)
    if not os.path.isfile(src):
        raise FileNotFoundError("Video not found: " + filename)
    dest_dir = library.input_root()
    os.makedirs(dest_dir, exist_ok=True)
    name = "yi_frame_" + uuid.uuid4().hex[:10] + ".png"
    dest = os.path.join(dest_dir, name)
    try:
        t = float(time_sec)
    except (TypeError, ValueError):
        t = 0.0
    if t < 0:
        t = 0.0
    t_s = "{:.3f}".format(t)
    # Fast keyframe seek first; accurate decode-seek if that frame is empty.
    attempts = [
        [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
         "-ss", t_s, "-i", src, "-an", "-frames:v", "1", "-q:v", "2", dest],
        [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
         "-i", src, "-ss", t_s, "-an", "-frames:v", "1", "-q:v", "2", dest],
    ]
    err = ""
    for cmd in attempts:
        if os.path.isfile(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
        r = _run(cmd, timeout=90)
        if r.returncode == 0 and os.path.isfile(dest) and os.path.getsize(dest) > 100:
            return {"ok": True, "name": name, "filename": name, "subfolder": "", "type": "input"}
        err = (r.stderr or b"").decode("utf-8", "ignore")[-400:]
    raise RuntimeError("Could not grab that frame. " + err)


def concat_clips(items):
    ffmpeg = _need_ffmpeg("stitch")
    if not items or len(items) < 2:
        raise ValueError("Need at least two clips to stitch.")
    paths = []
    for it in items:
        p = library.resolve_media(
            it.get("filename") or "",
            it.get("subfolder") or "",
            it.get("type") or "output",
        )
        if not os.path.isfile(p):
            raise FileNotFoundError("Missing clip: " + (it.get("filename") or ""))
        paths.append(p)
    out_dir = library.output_root()
    os.makedirs(out_dir, exist_ok=True)
    name = "YourImagination_film_" + uuid.uuid4().hex[:8] + ".mp4"
    dest = os.path.join(out_dir, name)
    with tempfile.TemporaryDirectory(prefix="yi-film-") as tmp:
        lst = os.path.join(tmp, "list.txt")
        with open(lst, "w", encoding="utf-8") as f:
            for p in paths:
                safe = p.replace("\\", "/").replace("'", "'\\''")
                f.write("file '" + safe + "'\n")
        cmd = [
            ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", lst,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
            dest,
        ]
        r = _run(cmd, timeout=300)
        if r.returncode != 0 or not os.path.isfile(dest):
            err = (r.stderr or b"").decode("utf-8", "ignore")[-500:]
            raise RuntimeError("Stitch failed. " + err)
    return {
        "ok": True,
        "filename": name,
        "subfolder": "",
        "type": "output",
        "kind": "video",
    }
