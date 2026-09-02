"""
recipes.py — pack-aware prompt rewrite (no LLM).

✦ is a structure helper for the selected pack, not a content factory.
MiniMax H3 video / Film wrap the user's text into official fields
(shot blocks, optional timing, picture alignment, dialogue slot).
NSFW extras stay off unless that chip is on and the job is sex-capable
video (I2V / R2V / Film). Stills, T2I, R2I, and Edit get light cleanup.
"""

from __future__ import annotations

import re


def _clean(text):
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


_H3_KEYS = (
    "integrated_multimodal_description",
    "overall_soundscape",
    "non_diegetic_music",
    "dialogue",
    "spoken_dialogue",
)

_SPEECH_VERBS = (
    r"(?:asks?|asked|asking|says?|said|saying|"
    r"shouts?|shouted|shouting|screams?|screamed|screaming|"
    r"whispers?|whispered|whispering|tells?|told|telling|"
    r"yells?|yelled|yelling|speaks?|spoke|speaking|"
    r"talks?|talked|talking|replies?|replied|replying|"
    r"mutters?|muttered|muttering|moans?|moaned|moaning|"
    r"gasps?|gasped|gasping|calls?|called|calling|"
    r"murmurs?|murmured|murmuring|pleads?|pleaded|pleading|"
    r"begs?|begged|begging)"
)
_QUOTE_RE = re.compile(
    r"[“\"«]([^”\"»\n]{1,400})[”\"»]"
)
_SUBJECT_SAYS_RE = re.compile(
    r"\bThe subject says:\s*[“\"]([^”\"]+)[”\"]",
    re.I,
)
_SAYS_COLON_RE = re.compile(
    r"\b" + _SPEECH_VERBS + r"(?:\s+(?:you|him|her|them|me|us))?\s*[:,]\s*[“\"']?([^.”\"'\n]{2,240})",
    re.I,
)
_SAYS_BARE_RE = re.compile(
    r"\b" + _SPEECH_VERBS +
    r"(?:\s+(?:you|him|her|them|me|us))?"
    r"\s+(?:that\s+)?"
    r"(?!to\b|if\b|whether\b|nothing\b|no\b|something\b|it\b|about\b|with\b|at\b|for\b|from\b)"
    r"([^,.;\n]{2,160})",
    re.I,
)
_TELLS_TO_RE = re.compile(
    r"\b(?:tells?|told|telling|asks?|asked|asking)"
    r"(?:\s+(?:you|him|her|them|me))?"
    r"\s+to\s+([^,.;\n]{2,160})",
    re.I,
)
_SPEAKING_SAYING_RE = re.compile(
    r"\b(?:speaking|talking)\s+and\s+saying\s+"
    r"(?!nothing\b|something\b|no\b)"
    r"([^,.;\n]{2,160})",
    re.I,
)
_SILENT_RE = re.compile(
    r"\b(no dialogue|no speech|no talking|no voice(?:over|-over)?|no narration|"
    r"no one (?:is )?(?:talking|speaking)|nobody (?:is )?(?:talking|speaking|talks|speaks)|"
    r"without (?:any )?(?:speech|dialogue|talking)|"
    r"do not (?:speak|talk|narrate|read))\b",
    re.I,
)
_BOILER_SILENCE_RE = re.compile(
    r"\bNo spoken dialogue\.\s*No voiceover\.\s*Do not read this prompt aloud\.?",
    re.I,
)
_SPEECH_INTENT_RE = re.compile(
    r"\b" + _SPEECH_VERBS + r"\b",
    re.I,
)
_ASKS_WANT_RE = re.compile(
    r"\b(?:and\s+)?" + _SPEECH_VERBS +
    r"(?:\s+you)?\s+if\s+you\s+(?:want to|wanna|would like to)\s+([^,.;\n]{2,160})",
    re.I,
)
_ASKS_IF_RE = re.compile(
    r"\b(?:and\s+)?" + _SPEECH_VERBS +
    r"(?:\s+you)?\s+(?:if|whether)\s+([^,.;\n]{2,160})",
    re.I,
)
_UNDRESS_RE = re.compile(
    r"\b(nude|naked|nsfw|topless|bottomless|undress(?:es|ed|ing)?|strips?|stripped|"
    r"shirtless|wearing nothing|fully nude|"
    r"pulls? off|takes? off|removes? (?:her |his |the )?(?:shirt|top|bra|clothes|clothing)|"
    r"breasts?|nipples?|\btits?\b|boobs?)\b",
    re.I,
)
_WARDROBE_LINE_RE = re.compile(
    r"Keep identity, wardrobe, and lighting consistent for the whole shot\.?",
    re.I,
)
_BODY_LINE = (
    "Keep identity, lighting, and body consistent for the whole shot. "
    "Clothing that comes off stays off."
)
_H3_BODY = (
    "Two distinct adult bodies: five fingers per hand, "
    "both legs attached at the hips and visible when the pose requires them, "
    "no extra limbs, no missing limbs, no fused torsos."
)
_H3_FACE_LOCK = (
    "Keep each person's face locked to the matching Picture tag; do not average or blend faces."
)
_H3_FACE_FRAME = (
    "Keep each person's face locked to the first frame; do not average or blend faces."
)
_H3_POSE_LOCK = (
    "Keep the exact sex position and body placement already described. "
    "Do not invent a different position."
)
_H3_ANATOMY_NEG = (
    "missing legs, amputated limb, floating leg, one-legged, "
    "penis on the woman, vagina on the man, penis coming out of a vagina, "
    "shemale, futa, mixed genitals, two sets of genitals on one body, "
    "penis fused to abdomen, scrotum fused to shaft, extra bulge at base of penis, "
    "tentacle penis, melted genitals, stub penis, "
    "obese, chubby belly, thick waist, skinny, waif, undefined face, morphing face, "
    "beauty filter, sister lookalike, cousin lookalike, generic pretty face"
)
_REV_COWGIRL_RE = re.compile(
    r"\breverse cowgirl\b|"
    r"\b(?:cowgirl|riding him|woman on top).{0,80}facing (?:the )?camera\b|"
    r"\bfacing (?:the )?camera.{0,80}(?:cowgirl|on (?:him|his penis))\b",
    re.I | re.S,
)
_COWGIRL_RE = re.compile(
    r"\b(cowgirl|reverse cowgirl|woman on top|riding him|she rides|"
    r"straddl(?:e|ing) (?:him|his))\b",
    re.I,
)
_HETERO_SEX_RE = re.compile(
    r"\b(cowgirl|missionary|doggystyle|doggy style|from behind|"
    r"on his penis|his penis|her pussy|her vagina|inside her)\b",
    re.I,
)
_FEMALE_HINT_RE = re.compile(
    r"\b(woman|female|girl|lady|she|her|hers|pussy|vagina|clit|breasts?)\b",
    re.I,
)
_MALE_HINT_RE = re.compile(
    r"\b(man|male|boy|guy|he|him|his|penis|cock|balls|scrotum)\b",
    re.I,
)
_OLD_ANATOMY_RE = re.compile(
    r"(?:Two distinct adult bodies with correct anatomy:.*?abdomen\.|"
    r"Male anatomy is a normal erect penis.*?abdomen\.|"
    r"Two distinct adult bodies:.*?no fused torsos\.|"
    r"Keep each person's face locked to the matching Picture tag;[^.]*\.|"
    r"Keep each person's face locked to the first frame;[^.]*\.|"
    r"Keep each person's face, hair, breast or chest shape,[^.]*\.|"
    r"<Picture \d+>\s*\([^)]*\) is the (?:woman|man)[^.]*\.(?:\s*(?:The groin|Do not attach|his penis)[^.]*\.){0,3}|"
    r"(?:<Picture \d+>\s*\([^)]*\)|\b[A-Za-z][\w-]*)\s+is the woman(?: in front)? — vagina only, no penis\.[^.]*\.(?:\s*(?:The groin|Do not attach)[^.]*\.){0,2}|"
    r"(?:<Picture \d+>\s*\([^)]*\)|\b[A-Za-z][\w-]*)\s+is the man(?: behind her)? —[^.]*\.|"
    r"(?:<Picture \d+>\s*\([^)]*\)|\b[A-Za-z][\w-]*)\s+is an adult (?:woman|man)\. (?:She has a vagina\. She has no penis\.|He has a penis\. He has no vagina\.)(?:\s*(?:The groin in the foreground is hers\.|His penis is inside her, not on her body\.))?|"
    r"Exactly one penis in the shot, only on the man\. Do not grow a vagina on the man\. Do not grow a penis on the woman\.|"
    r"The body facing the camera is the woman\.[^.]*\.(?:\s*[^.]*\.){0,2}|"
    r"Each person keeps only the genitals that match their sex\.[^.]*\.(?:\s*[^.]*\.){0,1}|"
    r"Keep the exact sex position and body placement already described\.\s*Do not invent a different position\.|"
    r"Reverse cowgirl:[^.]*\.(?:\s*[^.]*\.){0,4}|"
    r"Cowgirl:[^.]*\.(?:\s*[^.]*\.){0,3}|"
    r"Missionary:[^.]*\.(?:\s*[^.]*\.){0,2}|"
    r"From behind:[^.]*\.(?:\s*[^.]*\.){0,2})",
    re.I | re.S,
)
_MISSIONARY_RE = re.compile(
    r"\b(missionary|on her back|him over her|man on top|him on top|"
    r"her legs around (?:him|his))\b",
    re.I,
)
_DOGGY_RE = re.compile(
    r"\b(doggystyle|doggy style|doggy|from behind|on all fours|bent over)\b",
    re.I,
)
_H3_CAM_LOCK = "Throughout, the camera is locked, tripod-still."
_ADLIB = "__adlib__"
# Official H3 speech uses (S1) / says: / <d>. Silent clips omit those.
# Bracketed tags match [Shot N] — structure, not a line to read aloud.
_H3_SILENT_TAG = "[no speaker]"
_FACTORY_STRIP_RE = re.compile(
    r"(?:Throughout, the camera is locked, tripod-still\.|"
    r"Already in the act at 0\.00s\. Do not fade in from black\. No cinematic grain, no moody grade\.|"
    r"Hold the pose\.|"
    r"No spoken dialogue\. No voiceover\. Do not read this prompt aloud\.|"
    r"Two distinct adult bodies: five fingers per hand,[^.]*no fused torsos\.|"
    r"Live-action(?: adult video)?,?\s*(?:cinematic,?\s*)?photoreal(?:istic)?"
    r"(?:,?\s*a medium-wide shot)?"
    r"(?:\s+begins exactly from the composition in Picture 1:)?\s*|"
    r"Uncensored adult photograph, wearing nothing, fully nude\.\s*)",
    re.I,
)
_SOUND_HINT_RE = re.compile(
    r"\b(sound(?:scape)?|audio|ambient|music|diegetic|foley|"
    r"birds(?:ong)?|thunder|rain|waves|wind|footsteps|room tone)\b",
    re.I,
)
_CAM_HINT_RE = re.compile(
    r"\b(camera|dolly|handheld|steadicam|crane|gimbal|orbit|"
    r"pans?\b|panning|tilts?\b|tilting|tracking shot|"
    r"push[- ]?in|pull[- ]?(?:out|back)|zoom(?:s|ing)?|"
    r"whip[- ]?pan|drone|locked[- ]off|tripod|static shot)\b",
    re.I,
)
_SHOT_MARK_RE = re.compile(
    r"\[Shot\s+(\d+)\](?:\s+(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)s?)?",
    re.I,
)
_PICTURE_ALIGN_RE = re.compile(
    r"<Picture\s+\d+>\s+is\b[^.]*\.(?:\s*Ignore clothing in this identity reference;[^.]*\.)?\s*",
    re.I,
)
_ALIGN_TAIL_RE = re.compile(
    r"(?:These are identity references, not the first frame\.|"
    r"This is an identity reference, not the first frame\.|"
    r"Identity pictures lock face and hair, not the first frame\.[^.]*\.|"
    r"This is a setting and pose reference, not a person\.)\s*",
    re.I,
)


def already_structured(text, recipe):
    t = (text or "").lower()
    if recipe == "h3":
        return "integrated_multimodal_description" in t
    return False


def _h3_still_mode(mode):
    return (mode or "").lower() in ("t2i", "i2i", "edit", "r2i")


def _clip_secs(duration):
    try:
        n = float(duration or 0)
    except (TypeError, ValueError):
        return 0.0
    if n <= 0:
        return 0.0
    return max(1.0, min(15.0, n))


def _h3_user_sound(text):
    return bool(_SOUND_HINT_RE.search(text or ""))


def _h3_user_camera(text):
    return bool(_CAM_HINT_RE.search(text or ""))


def _h3_wrap_shot(visual, duration=0):
    t = (visual or "").strip()
    if _SHOT_MARK_RE.search(t):
        return _h3_ensure_shot_timing(t, duration)
    secs = _clip_secs(duration)
    if secs:
        return f"[Shot 1] 0.00-{secs:.2f}s {t}"
    return f"[Shot 1] {t}"


def _h3_ensure_shot_timing(text, duration):
    secs = _clip_secs(duration)
    if not secs:
        return text
    t = text or ""
    marks = list(_SHOT_MARK_RE.finditer(t))
    if not marks:
        return t
    if all(m.group(2) and m.group(3) for m in marks):
        return t
    n = len(marks)
    span = secs / n
    out = []
    last = 0
    for i, m in enumerate(marks):
        out.append(t[last:m.start()])
        a = i * span
        b = secs if i == n - 1 else (i + 1) * span
        out.append(f"[Shot {m.group(1)}] {a:.2f}-{b:.2f}s")
        last = m.end()
    out.append(t[last:])
    return "".join(out)


def rewrite(idea, recipe="photo", mode="t2i", style="", camera="", has_image=False, nsfw=False,
            h3_path="", ref_count=0, has_last=False, character_tags=None, scene_flags=None,
            duration=0, want_audio=None, film=False, scene_lora="",
            dialogue="", soundscape="", music=""):
    idea = _clean(idea)
    if not idea:
        return ""
    recipe = (recipe or "photo").lower()

    # Switching off MiniMax: keep the visual idea, drop Hailuo keys.
    if recipe != "h3" and _looks_like_h3(idea):
        idea = _h3_visual_only(idea)

    if recipe == "h3":
        if _h3_still_mode(mode):
            return h3_still(
                idea, has_image, nsfw=nsfw, ref_count=ref_count, h3_path=h3_path,
                character_tags=character_tags, scene_flags=scene_flags,
                scene_lora=scene_lora,
            )
        if already_structured(idea, "h3"):
            return _h3_ensure_audio_slots(
                idea, nsfw=nsfw, character_tags=character_tags,
                ref_count=ref_count, h3_path=h3_path, scene_flags=scene_flags,
                duration=duration, want_audio=want_audio, camera=camera,
                scene_lora=scene_lora,
                spoken_in=dialogue, soundscape_in=soundscape, music_in=music,
            )
        return h3(
            idea, mode, style, camera, has_image, nsfw=nsfw,
            h3_path=h3_path, ref_count=ref_count, has_last=has_last,
            character_tags=character_tags, scene_flags=scene_flags,
            duration=duration, want_audio=want_audio, film=film,
            scene_lora=scene_lora,
            spoken_in=dialogue, soundscape_in=soundscape, music_in=music,
        )
    if recipe == "qwen_edit":
        return qwen_edit(idea, has_image, nsfw=nsfw)
    if recipe == "ltx":
        return ltx(idea, camera, has_image)
    if recipe == "klein":
        return klein(idea, has_image, nsfw=nsfw)
    return photo(idea, style, nsfw=nsfw)


def _looks_like_h3(text):
    t = (text or "").lower()
    return "integrated_multimodal_description" in t


def _h3_field_map(text):
    fields = {}
    current = None
    chunks = []
    alignment = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        key = None
        rest = None
        low = line.lower()
        for k in _H3_KEYS:
            prefix = k + ":"
            if low.startswith(prefix):
                key = k
                rest = line[len(prefix):].strip()
                break
        if key:
            if current:
                fields[current] = " ".join(chunks).strip()
            current = key
            chunks = [rest] if rest else []
        elif current:
            chunks.append(line)
        else:
            alignment.append(line)
    if current:
        fields[current] = " ".join(chunks).strip()
    if alignment:
        fields["_alignment"] = " ".join(alignment)
    return fields


def _h3_visual_only(text):
    fields = _h3_field_map(text)
    body = fields.get("integrated_multimodal_description") or text
    body = re.sub(r"^\[Shot\s+\d+\]\s*", "", body, flags=re.I)
    body = _h3_scrub_visual(body)
    body = _h3_strip_locks(body)
    body = re.sub(
        r"^(?:establishes|opens with|begins exactly from the composition in Picture 1:)\s*",
        "",
        body,
        flags=re.I,
    )
    return _clean(body) or text


def _strip_silence_boiler(text):
    t = _BOILER_SILENCE_RE.sub(" ", text or "")
    t = re.sub(r"(?im)^\s*dialogue:\s*none\s*$", " ", t)
    t = re.sub(r"\bdialogue:\s*none\b", " ", t, flags=re.I)
    t = re.sub(r"\bspoken dialogue:\s*none\b", " ", t, flags=re.I)
    return t


def _looks_undressed(text):
    return bool(_UNDRESS_RE.search(text or ""))


def _rev_cowgirl(visual):
    return bool(_REV_COWGIRL_RE.search(visual or ""))


def _woman_front(visual):
    t = visual or ""
    if _rev_cowgirl(t):
        return True
    return bool(_COWGIRL_RE.search(t) and re.search(r"facing (?:the )?camera", t, re.I))


def _sex_from_tag(name, visual):
    tag = str(name or "").strip()
    if re.search(r"\b(woman|female|girl|lady)\b", tag, re.I):
        return "f"
    if re.search(r"\b(man|male|boy|guy)\b", tag, re.I):
        return "m"
    if not tag or re.match(r"character\s+\d+$", tag, re.I):
        return None
    # Explicit "Name is the woman" wins over nearby "mounts his penis" windows.
    if re.search(
        rf"{re.escape(tag)}.{{0,40}}(?:is |as )?(?:the )?\b(?:woman|female|girl|lady)\b",
        visual or "",
        re.I,
    ):
        return "f"
    if re.search(
        rf"{re.escape(tag)}.{{0,40}}(?:is |as )?(?:the )?\b(?:man|male|boy|guy)\b",
        visual or "",
        re.I,
    ):
        return "m"
    hits = []
    for m in re.finditer(re.escape(tag), visual or "", re.I):
        window = (visual or "")[max(0, m.start() - 48): m.end() + 48]
        # Pair phrases ("A and B, already… her pussy… his penis") mix both sexes.
        if re.search(r"\b(?:and|,)\s+" + re.escape(tag), window, re.I) or re.search(
            re.escape(tag) + r"\s+and\b", window, re.I
        ):
            continue
        f = bool(_FEMALE_HINT_RE.search(window))
        male = bool(_MALE_HINT_RE.search(window))
        if f and not male:
            hits.append("f")
        elif male and not f:
            hits.append("m")
    if hits and all(h == hits[0] for h in hits):
        return hits[0]
    return None


def _infer_pair_sexes(visual, names):
    sexes = [_sex_from_tag(name, visual) for name in names]
    known = [(i, s) for i, s in enumerate(sexes) if s]
    if len(names) == 2 and len(known) == 1 and _HETERO_SEX_RE.search(visual or ""):
        i, s = known[0]
        sexes[1 - i] = "m" if s == "f" else "f"
    woman_i = next((i for i, s in enumerate(sexes) if s == "f"), None)
    man_i = next((i for i, s in enumerate(sexes) if s == "m"), None)
    if (
        woman_i is None and man_i is None and len(names) == 2
        and _woman_front(visual) and _HETERO_SEX_RE.search(visual or "")
    ):
        # Woman-facing-camera sex: Character 1 is the body in front unless tagged otherwise.
        woman_i, man_i = 0, 1
    return woman_i, man_i


_SCENE_HINT_RE = re.compile(
    r"\b(scene|setting|pose|room|bed|location|background|hotel|env(?:ironment)?)\b",
    re.I,
)


def _flag_is_scene(value):
    if isinstance(value, str):
        return value.strip().lower() in (
            "scene", "setting", "pose", "location", "1", "true", "yes",
        )
    return bool(value)


def _norm_scene_flags(n, scene_flags=None, character_tags=None):
    n = max(0, int(n or 0))
    raw = list(scene_flags or [])
    tags = list(character_tags or [])
    out = []
    for i in range(n):
        if i < len(raw) and raw[i] is not None and raw[i] != "":
            out.append(_flag_is_scene(raw[i]))
        else:
            tag = tags[i] if i < len(tags) else ""
            out.append(bool(_SCENE_HINT_RE.search(str(tag or ""))))
    return out


def _h3_genital_lock(visual, character_tags=None, ref_count=0, r2v=False, scene_flags=None):
    t = visual or ""
    tags = list(character_tags or [])
    n = max(int(ref_count or 0), len(tags), 0)
    names = _char_names(n, tags) if n else []
    flags = _norm_scene_flags(n, scene_flags, tags) if n else []
    id_idxs = [i for i in range(n) if not (flags and flags[i])]
    id_names = [names[i] for i in id_idxs] if names else []
    woman_local, man_local = _infer_pair_sexes(t, id_names) if id_names else (None, None)
    woman_i = id_idxs[woman_local] if woman_local is not None and woman_local < len(id_idxs) else None
    man_i = id_idxs[man_local] if man_local is not None and man_local < len(id_idxs) else None
    front = _woman_front(t)
    parts = []

    def _who(i, nm):
        if r2v:
            return f"<Picture {i + 1}> ({nm})"
        return nm

    if names and (woman_i is not None or man_i is not None):
        if woman_i is not None and woman_i < len(names):
            who = _who(woman_i, names[woman_i])
            if front:
                parts.append(
                    f"{who} is an adult woman. She has a vagina. She has no penis. "
                    "The groin in the foreground is hers."
                )
            else:
                parts.append(
                    f"{who} is an adult woman. She has a vagina. She has no penis."
                )
        if man_i is not None and man_i < len(names):
            who = _who(man_i, names[man_i])
            if front:
                parts.append(
                    f"{who} is an adult man. He has a penis. He has no vagina. "
                    "His penis is inside her, not on her body."
                )
            else:
                parts.append(
                    f"{who} is an adult man. He has a penis. He has no vagina."
                )
        parts.append(
            "Exactly one penis in the shot, only on the man. "
            "Do not grow a vagina on the man. Do not grow a penis on the woman."
        )
    return " ".join(parts)


def _h3_visual_locks(visual, character_tags=None, ref_count=0, r2v=False, nsfw=False,
                    scene_flags=None):
    """NSFW video extras only: bind named pictures, pose cadence if they described sex."""
    if not nsfw:
        return ""
    bits = []
    genital = _h3_genital_lock(
        visual, character_tags, ref_count, r2v=r2v, scene_flags=scene_flags,
    )
    if genital:
        bits.append(genital)
    sex = bool(
        _looks_undressed(visual) or _HETERO_SEX_RE.search(visual or "")
        or _COWGIRL_RE.search(visual or "") or _MISSIONARY_RE.search(visual or "")
        or _DOGGY_RE.search(visual or "")
    )
    if sex:
        bits.append(_h3_pose_addendum(visual))
    return " ".join(bits)


def _h3_strip_locks(text):
    t = _OLD_ANATOMY_RE.sub(" ", text or "")
    t = _FACTORY_STRIP_RE.sub(" ", t)
    t = _WARDROBE_LINE_RE.sub(" ", t)
    t = _BOILER_SILENCE_RE.sub(" ", t)
    t = re.sub(re.escape(_BODY_LINE), " ", t, flags=re.I)
    t = re.sub(re.escape(_H3_FACE_LOCK), " ", t, flags=re.I)
    t = re.sub(re.escape(_H3_FACE_FRAME), " ", t, flags=re.I)
    t = re.sub(re.escape(_H3_POSE_LOCK), " ", t, flags=re.I)
    t = re.sub(re.escape(_H3_BODY), " ", t, flags=re.I)
    return re.sub(r"\s{2,}", " ", t).strip()


def _merge_neg(neg, extra):
    neg = (neg or "").strip().strip(",")
    extra = (extra or "").strip().strip(",")
    if not extra:
        return neg
    have = {p.strip().lower() for p in neg.split(",") if p.strip()}
    add = [p.strip() for p in extra.split(",") if p.strip() and p.strip().lower() not in have]
    if not add:
        return neg
    return (neg + ", " + ", ".join(add)).strip(", ") if neg else ", ".join(add)


def _h3_pose_addendum(visual):
    t = visual or ""
    bits = [_H3_POSE_LOCK]
    cowgirl = bool(_COWGIRL_RE.search(t))
    missionary = bool(_MISSIONARY_RE.search(t))
    doggy = bool(_DOGGY_RE.search(t))
    rev = _rev_cowgirl(t)
    if missionary and not cowgirl:
        bits.append(
            "Missionary: woman on her back, man on top between her legs, "
            "both of her thighs around his waist, both legs visible. "
            "Do not switch to cowgirl or sitting on him."
        )
    elif rev:
        bits.append(
            "Reverse cowgirl: she sits on him facing the camera, away from his face, "
            "both knees on the bed, thighs outside his hips straddling him. "
            "The body facing the camera is hers. The groin in the foreground is her vagina — "
            "do not attach a penis to her. He is behind her; his penis is inside her, "
            "not on her body. Both of her legs visible and planted."
        )
    elif cowgirl:
        bits.append(
            "Cowgirl: she sits on him facing him, both knees on the bed, "
            "thighs outside his hips straddling him, both legs visible and planted. "
            "His penis is inside her; she has mounted him, not hovering over his lap. "
            "Do not hide or amputate a leg."
        )
    elif doggy:
        bits.append(
            "From behind: she is on hands and knees or bent over, he is behind her. "
            "Both of her legs planted. Do not switch to cowgirl."
        )
    return " ".join(bits)


def _norm_scene_lora(scene):
    s = (scene or "").strip().lower()
    if s in ("masturbation", "hmmasturbation", "hm"):
        return "masturbation"
    if s in ("fingering", "finger"):
        return "fingering"
    if s in ("cowgirl",):
        return "cowgirl"
    return ""


def _apply_scene_lora(visual, scene_lora):
    """Inject trigger / motion lines only when that per-clip chip is on."""
    scene = _norm_scene_lora(scene_lora)
    t = visual or ""
    if scene == "cowgirl":
        bits = []
        if "cowgirl position" not in t.lower():
            bits.append("cowgirl position")
        if "thrusting" not in t.lower():
            bits.append("thrusting her body")
        if not bits:
            return t
        return (t.rstrip(".") + ". " + ", ".join(bits) + ".").strip()
    if scene == "fingering":
        if re.search(
            r"\b(in and out|up and down|circles?|circling|rubs?|rubbing|"
            r"strokes?|stroking|rhythm)\b",
            t, re.I,
        ):
            return t
        extra = "Her fingers move in a steady rhythm, rubbing and sliding in and out."
        return (t.rstrip(".") + ". " + extra).strip()
    if scene == "masturbation":
        bits = []
        if "hmmasturbation" not in t.lower():
            bits.append("hmmasturbation")
        if not re.search(
            r"\b(masturbat|rubs? her|fingers? (?:on|in|over)|clitoris|clit)\b",
            t, re.I,
        ):
            bits.append("She is masturbating, fingers rubbing her clitoris in a steady rhythm.")
        if not bits:
            return t
        return (t.rstrip(".") + ". " + " ".join(bits)).strip()
    return t


def _h3_pose_neg(visual):
    t = visual or ""
    extra = []
    cowgirl = bool(_COWGIRL_RE.search(t))
    missionary = bool(_MISSIONARY_RE.search(t))
    doggy = bool(_DOGGY_RE.search(t))
    if missionary and not cowgirl:
        extra.append("woman sitting side-saddle, one leg missing, legs together not straddling")
    if cowgirl:
        extra.append("side-saddle, one leg missing, legs together not straddling")
    if doggy and not cowgirl:
        extra.append("woman sitting on him facing the camera, missing legs")
    return ", ".join(extra)


def _spoken_from_want(rest):
    rest = (rest or "").strip(" .")
    if not rest:
        return None
    if rest.lower().startswith("to "):
        rest = rest[3:].strip()
    return f"Do you want to {rest}?"


_SHOT_DUMP_RE = re.compile(
    r"\[Shot\s+\d+\]|"
    r"integrated_multimodal_description|"
    r"begins exactly from the composition|"
    r"Keep identity|"
    r"Picture 1 is the exact first frame|"
    r"opens with <Picture|"
    r"\bSame look:|"
    r"Live-action|"
    r"hmmasturbation|"
    r"Throughout, the camera|"
    r"Keep the exact sex position|"
    r"\boverall_soundscape\b|"
    r"\bmatching the scene\b|"
    r"medium-wide shot",
    re.I,
)
_DIRECTION_RE = re.compile(
    r"\b(?:camera|composition|lighting|identity|throughout|"
    r"begins exactly|live-action|photoreal|soundscape|same look|keep identity|"
    r"picture 1|first frame|medium-wide|bed|roof)\b",
    re.I,
)
_SOUND_META_RE = re.compile(
    r"\b(?:matching the scene(?: only)?|under the spoken line|"
    r"no speech|no narration|no narrator|no voiceover|"
    r"diegetic only|consistent with the scene)\b",
    re.I,
)
_VISUAL_AUDIO_LEAK_RE = re.compile(
    r"(?:"
    r"\bNo spoken dialogue\.\s*No voiceover\.\s*Do not read this prompt aloud\.?|"
    r"\bThe subject says:\s*[“\"].*?[”\"]|"
    r"\b(?:overall_soundscape|soundscape(?:\s+later)?|dialogue|spoken(?:\s+dialogue)?|"
    r"non_diegetic_music)\s*:\s*[^\n]+|"
    r"\bno speech,?\s*no narration|"
    r"\bnatural ambient (?:sound|room tone)(?: matching the scene)?(?: only)?"
    r"(?:[,.]?\s*under the spoken line)?|"
    r"\bambient sound matching the scene"
    r")",
    re.I | re.S,
)
_GENERIC_SOUND_RE = re.compile(
    r"^(?:natural ambient (?:sound|room tone)(?: matching the scene)?"
    r"(?:[,.]?\s*under the spoken line)?|"
    r"natural ambient room tone consistent with the scene|"
    r"ambient sound matching the scene)\.?$",
    re.I,
)
_META_SAYS_RE = re.compile(
    r"\b(?:shot|prompt|text|description|field|line|user)\s+says\b",
    re.I,
)
_SOUNDSCAPE_CHUNK_RE = re.compile(
    r"\b(?:overall_soundscape|soundscape(?:\s+later)?)\s*:\s*"
    r"(.+?)(?=\s*(?:\b(?:dialogue|spoken(?:\s+dialogue)?|non_diegetic_music|"
    r"integrated_multimodal_description|music|score)\s*:|"
    r"\bNo (?:spoken )?dialogue\b|"
    r"(?<=\.)\s+(?=[A-Z“\"])|"
    r"$))",
    re.I | re.S,
)
_DIALOGUE_LABEL_RE = re.compile(
    r"(?im)^\s*(?:dialogue|spoken(?:\s+dialogue)?)\s*:\s*(.+)$"
)
_MUSIC_LINE_RE = re.compile(
    r"(?im)^\s*(?:non_diegetic_music|music|score)\s*:\s*(.+)$"
)
_EXPLICIT_NONE_RE = re.compile(
    r"(?i)(?:^\s*dialogue\s*:\s*(?:none|n/?a)\s*$|\bdialogue\s*:\s*(?:none|n/?a)\b|"
    r"\bNo (?:spoken )?dialogue\b)"
)
_DANGLING_SPEECH_RE = re.compile(
    r"\b(?:The subject says|" + _SPEECH_VERBS + r")\s*:\s*",
    re.I,
)
_SPEAKER_VERB_RE = re.compile(
    r"\b(?:(?:the subject)|she|he|they)\s+" + _SPEECH_VERBS + r"\s*:\s*",
    re.I,
)


def _looks_like_shot_dump(text):
    t = (text or "").strip()
    if not t:
        return False
    if _SHOT_DUMP_RE.search(t):
        return True
    if len(t) > 200 and re.search(
        r"\b(?:camera|composition|lighting|first frame|bed|roof)\b", t, re.I
    ):
        return True
    return False


def _sanitize_spoken(spoken):
    if spoken == _ADLIB:
        return None
    t = (spoken or "").strip().strip("\"“”'")
    if t.lower() in ("", "none", "n/a", "na", "no dialogue", "no speech"):
        return None
    if _looks_like_shot_dump(t):
        return None
    words = t.split()
    if len(t) > 120 or len(words) > 20:
        return None
    if _DIRECTION_RE.search(t) and len(words) > 8:
        return None
    if _SOUND_META_RE.search(t):
        return None
    return t


def _sanitize_soundscape(sc):
    t = (sc or "").strip().strip(" .")
    t = _SOUND_META_RE.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" ,.;")
    if not t or t.lower() in ("none", "n/a", "na"):
        return ""
    if _GENERIC_SOUND_RE.match(t):
        return ""
    words = t.split()
    if len(words) > 15:
        t = " ".join(words[:15])
    if _looks_like_shot_dump(t):
        return ""
    return t


def _sanitize_music(music):
    t = (music or "").strip()
    if not t or t.lower() in ("none", "n/a", "na"):
        return None
    if _looks_like_shot_dump(t):
        return None
    return t


def _peel_labeled_audio(text):
    """Pull Soundscape:/dialogue:/music: out of prose. Returns (visual, spoken, soundscape, music)."""
    raw = text or ""
    spoken = None
    soundscape = ""
    music = None

    dm = _DIALOGUE_LABEL_RE.search(raw)
    if dm:
        spoken = _sanitize_spoken(dm.group(1))
        raw = _DIALOGUE_LABEL_RE.sub(" ", raw)

    sm = _SOUNDSCAPE_CHUNK_RE.search(raw)
    if sm:
        soundscape = _sanitize_soundscape(sm.group(1))
        raw = _SOUNDSCAPE_CHUNK_RE.sub(" ", raw)

    mm = _MUSIC_LINE_RE.search(raw)
    if mm:
        music = _sanitize_music(mm.group(1))
        raw = _MUSIC_LINE_RE.sub(" ", raw)

    return raw, spoken, soundscape, music


def _split_audio(idea, spoken_in="", soundscape_in="", music_in=""):
    """Visual vs quoted speech vs diegetic sounds. Never copies the shot into audio slots."""
    visual, spoken, soundscape, music = _peel_labeled_audio(idea or "")
    vis2, quoted = _split_dialogue(visual, strict=True)
    visual = vis2
    if not spoken:
        spoken = quoted
    if spoken is None or spoken == _ADLIB:
        if _EXPLICIT_NONE_RE.search(idea or ""):
            spoken = None
    spoken = _sanitize_spoken(spoken_in) or _sanitize_spoken(spoken)
    soundscape = _sanitize_soundscape(soundscape_in) or _sanitize_soundscape(soundscape)
    forced_music = str(music_in or "").strip()
    if forced_music.lower() in ("n/a", "none", "na"):
        music = None
    else:
        music = _sanitize_music(music_in) or _sanitize_music(music)
    visual = _h3_scrub_visual(visual or "")
    return _clean(visual) or _clean(_h3_scrub_visual(idea)), spoken, soundscape, music


def _split_dialogue(idea, strict=True):
    """Return (visual_text, spoken_line_or_None). Quoted lines only — never the shot."""
    raw = idea or ""
    search = _strip_silence_boiler(raw)

    m = _SUBJECT_SAYS_RE.search(search)
    if m:
        dialogue = _sanitize_spoken(m.group(1))
        visual = _SUBJECT_SAYS_RE.sub(" ", search)
        return _clean(visual) or raw, dialogue

    quotes = [q.strip() for q in _QUOTE_RE.findall(search) if q.strip()]
    quotes = [q for q in quotes if _sanitize_spoken(q)]
    if quotes:
        dialogue = " ".join(q for q in (_sanitize_spoken(x) for x in quotes) if q)
        visual = _QUOTE_RE.sub(" ", search)
        visual = _SPEAKER_VERB_RE.sub(" ", visual)
        visual = re.sub(
            r"\b(?:and\s+)?(?:then\s+)?" + _SPEECH_VERBS + r"\s*[:,]?\s*$",
            "",
            visual,
            flags=re.I,
        )
        visual = re.sub(r"\s{2,}", " ", visual).strip(" ,.;")
        return visual or raw, dialogue or None

    if _EXPLICIT_NONE_RE.search(raw) or _SILENT_RE.search(search):
        visual = _SILENT_RE.sub(" ", search)
        visual = re.sub(r"(?im)^\s*dialogue\s*:\s*(?:none|n/?a)\s*$", " ", visual)
        visual = re.sub(r"\bdialogue\s*:\s*(?:none|n/?a)\b", " ", visual, flags=re.I)
        return _clean(visual) or raw, None

    if strict:
        return raw, None

    if _META_SAYS_RE.search(search):
        search_wo = _META_SAYS_RE.sub(" ", search)
    else:
        search_wo = search

    m = _ASKS_WANT_RE.search(search_wo)
    if m:
        spoken = _sanitize_spoken(_spoken_from_want(m.group(1)))
        if spoken:
            visual = (search_wo[: m.start()] + " " + search_wo[m.end() :]).strip(" ,.;")
            visual = re.sub(r"\s{2,}", " ", visual)
            return visual or raw, spoken

    m = _ASKS_IF_RE.search(search_wo)
    if m:
        clause = m.group(1).strip(" .")
        spoken = _spoken_from_want(clause) if re.match(r"(?:you\s+)?(?:want to|wanna)", clause, re.I) else (
            clause[:1].upper() + clause[1:] + ("?" if not clause.endswith("?") else "")
        )
        spoken = _sanitize_spoken(spoken)
        if spoken:
            visual = (search_wo[: m.start()] + " " + search_wo[m.end() :]).strip(" ,.;")
            visual = re.sub(r"\s{2,}", " ", visual)
            return visual or raw, spoken

    m = _TELLS_TO_RE.search(search_wo)
    if m:
        cmd = m.group(1).strip(" .")
        spoken = cmd[:1].upper() + cmd[1:]
        if not spoken.endswith((".", "!", "?")):
            spoken += "."
        spoken = _sanitize_spoken(spoken)
        if spoken:
            visual = (search_wo[: m.start()] + " " + search_wo[m.end() :]).strip(" ,.;")
            visual = re.sub(r"\s{2,}", " ", visual)
            return visual or raw, spoken

    for pat in (_SPEAKING_SAYING_RE, _SAYS_COLON_RE, _SAYS_BARE_RE):
        m = pat.search(search_wo)
        if m:
            dialogue = _sanitize_spoken(m.group(1).strip(" .,:;"))
            if dialogue:
                visual = (search_wo[: m.start()] + " " + search_wo[m.end() :]).strip(" ,.;")
                visual = re.sub(r"\s{2,}", " ", visual)
                return visual or raw, dialogue

    if _SILENT_RE.search(search_wo):
        visual = _SILENT_RE.sub(" ", search_wo)
        return _clean(visual) or raw, None

    if _SPEECH_INTENT_RE.search(search_wo) and not _META_SAYS_RE.search(search):
        return raw, _ADLIB

    return raw, None


def _h3_scrub_visual(text):
    """Action/camera only. Strip speakable audio labels and silence boiler."""
    t = text or ""
    t = _BOILER_SILENCE_RE.sub(" ", t)
    t = _VISUAL_AUDIO_LEAK_RE.sub(" ", t)
    t = _SUBJECT_SAYS_RE.sub(" ", t)
    t = _SPEAKER_VERB_RE.sub(" ", t)
    t = _DANGLING_SPEECH_RE.sub("", t)
    t = re.sub(re.escape(_H3_SILENT_TAG), " ", t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip(" ,.;")
    return t


def _h3_apply_speech(body, spoken, soundscape=None, want_audio=True, user_sound=False):
    """Dialogue stays in its own field. Visual body is never wrapped as VO."""
    body = _h3_scrub_visual(body or "")
    spoken = _sanitize_spoken(spoken)
    sc = _sanitize_soundscape(soundscape)
    if spoken:
        return body, sc or "room tone", f'"{spoken}"'
    if _H3_SILENT_TAG.lower() not in body.lower():
        body = body.rstrip()
        if body and not body.endswith((".", "!", "?")):
            body += "."
        body = f"{body} {_H3_SILENT_TAG}".strip()
    if want_audio or user_sound:
        sc = sc or "room tone"
    return body, sc, "none"


def _h3_ensure_audio_slots(text, nsfw=False, character_tags=None, ref_count=0, h3_path="",
                          scene_flags=None, duration=0, want_audio=None, camera="",
                          scene_lora="", spoken_in="", soundscape_in="", music_in=""):
    """Refresh an existing H3 prompt without dumping the shot into audio fields."""
    fields = _h3_field_map(text)
    body = fields.get("integrated_multimodal_description") or ""
    body, spoken, soundscape, music = _split_audio(
        body,
        spoken_in=spoken_in or fields.get("dialogue") or fields.get("spoken_dialogue") or "",
        soundscape_in=soundscape_in or fields.get("overall_soundscape") or "",
        music_in=music_in or fields.get("non_diegetic_music") or "",
    )

    path = (h3_path or "").lower()
    r2v = path in ("r2v", "r2va", "ref")
    body = _h3_strip_locks(body)
    body = _apply_scene_lora(body, scene_lora)
    body = _h3_ensure_shot_timing(body, duration)
    if nsfw and _looks_undressed(body):
        if _BODY_LINE.lower() not in body.lower():
            body = body.rstrip(".") + " " + _BODY_LINE
    visual_src = " ".join(x for x in (fields.get("_alignment"), body) if x)
    locks = _h3_visual_locks(
        visual_src, character_tags, ref_count, r2v=r2v,
        nsfw=bool(nsfw),
        scene_flags=scene_flags,
    )
    if locks:
        body = (body.rstrip(" .") + ". " + locks).strip()

    cam = (camera or "").strip()
    if cam and not _h3_user_camera(body):
        body = body.rstrip(".") + f" Throughout, {cam}."

    user_sound = bool(soundscape) or _h3_user_sound(body) or _h3_user_sound(text)
    audio_on = True if want_audio is None else bool(want_audio)
    body, soundscape, dialogue_line = _h3_apply_speech(
        body, spoken, soundscape,
        want_audio=audio_on, user_sound=user_sound,
    )

    return _h3_pack(
        fields.get("_alignment"), body, soundscape, dialogue_line, music or "N/A",
        want_audio=audio_on, user_sound=user_sound, spoken=spoken,
    )


def photo(idea, style="", nsfw=False):
    explicit = bool(re.search(
        r"\b(nude|naked|nsfw|sex|pussy|penis|cock|dick|vagina)\b", idea or "", re.I
    ))
    if nsfw and explicit:
        lead = (style or "").strip() or "Photorealistic adult photograph, natural skin"
        body = idea
        if not re.search(r"[.!?]$", body):
            body += "."
        extra = " Accurate anatomy for the person described, no extra genitals, no cartoon look."
        return f"{lead}. {body}{extra}"
    lead = (style or "").strip() or "Photorealistic, natural light, sharp detail"
    body = idea
    if not re.search(r"[.!?]$", body):
        body += "."
    extra = (
        " Shot on a full-frame camera, shallow depth of field where it helps the subject, "
        "accurate skin texture, believable materials, no illustration look."
    )
    if "photoreal" in idea.lower() or "cinematic" in idea.lower():
        extra = " Accurate materials, natural color, no plastic skin, no extra limbs."
    if nsfw:
        extra += " Keep correct anatomy. Do not add extra genitals."
    return f"{lead}. {body}{extra}"


def qwen_edit(idea, has_image, nsfw=False):
    body = idea
    if has_image:
        keep = (
            "Keep the exact same face: same features, expression, and the source "
            "photo's skin texture. Do not beautify or replace the person. Keep the same composition. "
        )
        if re.search(r"\b(keep|same face|identity|don't change the person)\b", idea, re.I):
            keep = ""
        extra = (
            " Match the source photo's skin texture — pores, grain, and finish — so the "
            "face is the same photographic product as the body and scene. Not airbrushed, "
            "not painterly, not sharpened. No extra genitals or mixed anatomy, no mosaic."
        )
        if nsfw:
            return keep + "SEXGOD. Apply this edit to the photo: " + body + extra
        return keep + "Edit the image: " + body + extra
    return photo(idea, nsfw=nsfw)


def klein(idea, has_image, nsfw=False):
    if has_image:
        keep = "Keep the same person, face, identity, and overall composition. "
        if re.search(r"\b(keep|same face|identity|don't change the person)\b", idea, re.I):
            keep = ""
        if nsfw:
            return (
                keep
                + "The person is wearing nothing, fully nude, uncensored adult photograph. "
                + idea
            )
        return keep + "Edit the image: " + idea
    if nsfw:
        return (
            "Uncensored adult photograph, the person is wearing nothing, fully nude, "
            "natural anatomy, photographic skin. " + idea
        )
    return photo(idea, nsfw=False)


_NSFW_CLOTHES_NEG = (
    "clothing, clothes, dressed, shirt, pants, underwear, bra, panties, bikini, "
    "covered, fabric covering the body, censored, mosaic, blur"
)


def already_nsfw_wrapped(text):
    t = (text or "").lower()
    return (
        "wearing nothing" in t
        or "fully nude" in t
        or "sexgod" in t
        or "uncensored adult" in t
    )


def ensure_nsfw(prompt, recipe="photo", has_image=False, nsfw=False, neg="", mode="",
                h3_path="", ref_count=0, has_last=False, character_tags=None, scene_flags=None,
                duration=0, want_audio=None, film=False, scene_lora="",
                dialogue="", soundscape="", music=""):
    """Apply NSFW wrap on generate even if the user skipped ✦."""
    prompt = prompt or ""
    neg = neg or ""
    if not nsfw:
        return prompt, neg
    recipe = (recipe or "photo").lower()
    adult = bool(
        _looks_undressed(prompt) or _HETERO_SEX_RE.search(prompt)
        or _COWGIRL_RE.search(prompt) or _MISSIONARY_RE.search(prompt)
        or _DOGGY_RE.search(prompt)
    )
    if not already_nsfw_wrapped(prompt):
        if recipe == "h3":
            prompt = rewrite(
                prompt, recipe="h3", mode=mode, has_image=has_image, nsfw=True,
                h3_path=h3_path, ref_count=ref_count, has_last=has_last,
                character_tags=character_tags, scene_flags=scene_flags,
                duration=duration, want_audio=want_audio, film=film,
                scene_lora=scene_lora,
                dialogue=dialogue, soundscape=soundscape, music=music,
            )
        elif recipe == "qwen_edit":
            prompt = rewrite(prompt, recipe="qwen_edit", has_image=has_image, nsfw=True)
        elif recipe == "klein":
            prompt = klein(prompt, has_image=has_image, nsfw=True)
        elif adult:
            prompt = (
                "Uncensored adult photograph, wearing nothing, fully nude. " + prompt
            )
    if recipe == "h3":
        if adult or (not _h3_still_mode(mode) and (
            _looks_undressed(prompt) or _HETERO_SEX_RE.search(prompt)
        )):
            extra = _H3_ANATOMY_NEG
            pose_neg = _h3_pose_neg(prompt)
            if pose_neg:
                extra = extra + ", " + pose_neg
            neg = _merge_neg(neg, extra)
            if "clothing" not in (neg or "").lower() and _looks_undressed(prompt):
                neg = (neg + ", " + _NSFW_CLOTHES_NEG).strip(", ")
        return prompt, neg
    if "clothing" not in (neg or "").lower():
        neg = (neg + ", " + _NSFW_CLOTHES_NEG).strip(", ")
    return prompt, neg


def _h3_ref_tags(text):
    t = text or ""
    t = t.replace("<Image 1>", "<Picture 1>").replace("<Image 2>", "<Picture 2>")
    t = t.replace("<image 1>", "<Picture 1>").replace("<image 2>", "<Picture 2>")
    return t


def _h3_pack(alignment, body, soundscape, dialogue_line="none", music="N/A",
             want_audio=True, user_sound=False, spoken=None):
    """Official MiniMax fields. Shot and dialogue stay on separate labeled lines."""
    lines = []
    if alignment:
        lines.append(_h3_ref_tags(alignment).strip())
    lines.append(f"integrated_multimodal_description: {_h3_ref_tags(body).strip()}")
    spoken_out = dialogue_line if dialogue_line not in (None, "") else "none"
    lines.append(f"dialogue: {spoken_out}")
    audio = bool(want_audio or user_sound or spoken)
    if audio:
        lines.append(f"overall_soundscape: {soundscape or 'room tone'}")
        lines.append(f"non_diegetic_music: {_sanitize_music(music) or 'N/A'}")
    return "\n".join(lines)


_R2V_WRAP_RE = re.compile(
    r"^(?:Picture 1 is the identity lock\..*?Restage only as described:\s*|"
    r"<(?:Image|Picture) \d+>.*?(?:Restage only as described:\s*)?)",
    re.I | re.S,
)


def _bare_still_visual(idea):
    t = _h3_visual_only(idea) if _looks_like_h3(idea) else _clean(idea)
    t = _h3_strip_locks(t)
    t = _R2V_WRAP_RE.sub("", t, count=1)
    t = _PICTURE_ALIGN_RE.sub("", t)
    t = _ALIGN_TAIL_RE.sub("", t)
    t = re.sub(r"^<(?:Image|Picture) \d+>[^.]*\.\s*", "", t)
    t = re.sub(r"^They are (?:identity|reference)[^.]*\.\s*", "", t, flags=re.I)
    t = re.sub(r"^Photoreal still photograph(?:, not a video)?\.\s*", "", t, flags=re.I)
    t = re.sub(r"^Restage only as described:\s*", "", t, flags=re.I)
    t = re.sub(r"^\[Shot\s+\d+\](?:\s+\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?s)?\s*", "", t, flags=re.I)
    t = re.sub(
        r"^(?:establishes|opens with|begins exactly from the composition in Picture 1:)\s*",
        "",
        t,
        flags=re.I,
    )
    t = _h3_ref_tags(t)
    return _clean(t) or _clean(idea)


def _char_tag(raw, index):
    t = " ".join(str(raw or "").split())
    t = t.replace("<", "").replace(">", "")
    if len(t) > 40:
        t = t[:40].rstrip()
    return t or f"Character {index}"


def _char_names(ref_count, character_tags=None):
    n = max(1, int(ref_count or 1))
    tags = list(character_tags or [])
    return [_char_tag(tags[i] if i < len(tags) else "", i + 1) for i in range(n)]


def _join_en(items):
    items = [str(x) for x in items if x]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


def _r2v_align(ref_count, character_tags=None, scene_flags=None, nsfw=False):
    """Official ref2va tags. Tokenizer injects <Picture i>: vision; the prompt must name those tags."""
    n = max(1, int(ref_count or 1))
    names = _char_names(n, character_tags)
    flags = _norm_scene_flags(n, scene_flags, character_tags)
    bits = []
    id_n = 0
    scene_n = 0
    for i in range(1, n + 1):
        if flags[i - 1]:
            scene_n += 1
            label = names[i - 1]
            generic = bool(re.match(r"character\s+\d+$", label, re.I))
            if i == 1:
                who = "" if generic else f" ({label})"
                bits.append(
                    f"<Picture 1>{who} is the opening composition at 0.00 seconds — "
                    "setting and body placement to match, not a third person."
                )
            elif generic:
                bits.append(
                    f"<Picture {i}> is the setting and body placement to match, not a third person."
                )
            else:
                bits.append(
                    f"<Picture {i}> is {label} — the setting and body placement to match, "
                    "not a third person."
                )
        else:
            id_n += 1
            line = f"<Picture {i}> is {names[i - 1]} — that exact face and hair."
            if nsfw:
                line += (
                    " Ignore clothing in this identity reference. "
                    "Lock the face to this picture: same bone structure, eyes, jaw, and nose; "
                    "sharp and specific, not a generic pretty face, not soft, not airbrushed, "
                    "not a beauty filter."
                )
            bits.append(line)
    if id_n and not scene_n:
        tail = (
            " This is an identity reference, not the first frame."
            if id_n == 1
            else " These are identity references, not the first frame."
        )
    elif id_n and scene_n:
        if flags and flags[0]:
            tail = (
                " Picture 1 is the opening composition at 0.00 seconds. "
                "Identity pictures lock face and hair."
            )
        else:
            tail = (
                " Identity pictures lock face and hair, not the first frame. "
                "Scene pictures are location and pose only."
            )
    elif scene_n:
        if flags and flags[0]:
            tail = (
                " Picture 1 is the opening composition at 0.00 seconds — "
                "location and body placement, not a third person."
            )
        else:
            tail = " This is a setting and pose reference, not a person."
    else:
        tail = ""
    return " ".join(bits) + tail


def _r2v_who(ref_count, appear=False, character_tags=None, scene_flags=None):
    n = max(1, int(ref_count or 1))
    names = _char_names(n, character_tags)
    flags = _norm_scene_flags(n, scene_flags, character_tags)
    id_pics = []
    id_names = []
    scene_bits = []
    for i in range(1, n + 1):
        if flags[i - 1]:
            scene_bits.append(f"<Picture {i}> is the setting and pose to match")
        else:
            id_pics.append(f"<Picture {i}>")
            id_names.append(names[i - 1])
    if not id_pics:
        return _join_en(scene_bits) or "the described scene"
    pic_s = _join_en(id_pics)
    name_s = _join_en(id_names)
    if appear:
        verb = "appears" if len(id_pics) == 1 else "appear"
        who = f"{pic_s} {verb} as {name_s}"
    else:
        who = f"{pic_s} as {name_s}"
    if scene_bits:
        who += ". " + _join_en(scene_bits)
    return who


def h3_still(idea, has_image, nsfw=False, ref_count=0, h3_path="", character_tags=None,
             scene_flags=None, scene_lora=""):
    """Stills / T2I / R2I / Edit: light cleanup. No H3 video shot template."""
    visual = _bare_still_visual(idea)
    refs = max(0, int(ref_count or 0))
    path = (h3_path or "").lower()
    r2v = path in ("r2v", "r2va", "ref")
    if r2v and refs:
        align = _r2v_align(refs, character_tags, scene_flags, nsfw=False)
        return _clean(align + " " + visual)
    return visual


def h3(idea, mode, style, camera, has_image, nsfw=False, h3_path="", ref_count=0, has_last=False,
       character_tags=None, scene_flags=None, duration=0, want_audio=None, film=False,
       scene_lora="", spoken_in="", soundscape_in="", music_in=""):
    visual, spoken, soundscape, music = _split_audio(
        idea, spoken_in=spoken_in, soundscape_in=soundscape_in, music_in=music_in,
    )
    visual = _apply_scene_lora(_h3_ref_tags(_h3_strip_locks(visual)), scene_lora)
    cam = (camera or "").strip()
    path = (h3_path or "").lower()
    refs = max(0, int(ref_count or 0))
    if film and not _clip_secs(duration):
        duration = 8
    audio_on = True if want_audio is None else bool(want_audio)
    if path in ("i2v", "i2va", "fl2v", "fl2va", "t2v", "t2va"):
        r2v = False
    else:
        r2v = path in ("r2v", "r2va", "ref") or (refs and not has_image and not has_last)
    fl2v = path in ("fl2v", "fl2va") or (has_image and has_last)
    alignment = ""
    if r2v:
        alignment = _r2v_align(refs or 1, character_tags, scene_flags, nsfw=bool(nsfw))
        who = _r2v_who(
            refs or 1, appear=False, character_tags=character_tags, scene_flags=scene_flags,
        )
        opening = f"opens with {who}: {visual}"
    elif fl2v:
        alignment = (
            "Picture 1 is the first frame at 0.00 seconds; Picture 2 is the final frame. "
            "Interpolate the motion between them in a single continuous shot."
        )
        opening = f"begins exactly from the composition in Picture 1: {visual}"
    elif has_image or (mode or "").lower() in ("i2v", "i2va"):
        alignment = (
            "Picture 1 is the exact first frame of the video at 0.00 seconds and belongs to [Shot 1]."
        )
        opening = f"begins exactly from the composition in Picture 1: {visual}"
    else:
        opening = visual

    lead = (style or "").strip()
    core = f"{lead} {opening}".strip() if lead else opening
    body = _h3_wrap_shot(core, duration)
    if not re.search(r"[.!?]$", body):
        body += "."
    if cam and not _h3_user_camera(body):
        body += f" Throughout, {cam}."
    if nsfw and _looks_undressed(visual):
        body += " " + _BODY_LINE
    extras = _h3_visual_locks(
        visual, character_tags, refs if r2v else 0, r2v=r2v, nsfw=bool(nsfw),
        scene_flags=scene_flags if r2v else None,
    )
    if extras:
        body += " " + extras

    user_sound = bool(soundscape) or _h3_user_sound(visual) or _h3_user_sound(idea)
    body, soundscape, dialogue_line = _h3_apply_speech(
        body, spoken, soundscape, want_audio=audio_on, user_sound=user_sound,
    )
    return _h3_pack(
        alignment, body, soundscape, dialogue_line, music or "N/A",
        want_audio=audio_on, user_sound=user_sound, spoken=spoken,
    )


def ltx(idea, camera, has_image):
    cam = (camera or "").strip() or "slow, single camera move"
    prefix = "Starting from the attached image as the first frame, " if has_image else ""
    return (
        f"{prefix}{idea}. Motion is continuous and physical. "
        f"Camera: {cam}. Avoid morphing faces, extra limbs, or sudden cuts."
    )
