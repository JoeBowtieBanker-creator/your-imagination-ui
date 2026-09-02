const $ = (s) => document.querySelector(s);
const ASPECTS = {
  "1:1": [1328, 1328],
  "16:9": [1536, 864],
  "9:16": [864, 1536],
  "3:2": [1472, 976],
  "2:3": [976, 1472],
};
const RATIOS = { "1:1": 1, "16:9": 16 / 9, "9:16": 9 / 16, "3:2": 3 / 2, "2:3": 2 / 3 };
const ASPECT_CHOICES = ["auto", "9:16", "2:3", "1:1", "3:2", "16:9"];
const H3_ASPECTS = {
  "1:1": [576, 576],
  "16:9": [1024, 576],
  "9:16": [576, 1024],
  "3:2": [864, 576],
  "2:3": [576, 864],
};
const FALLBACK_DEFAULTS = { image: "h3-video", ref_image: "h3-video", video: "h3-video", edit: "qwen-edit" };
const UI_MODE_LABEL = { image: "T2I", ref_image: "R2I", video: "Video", edit: "Edit" };
const UI_MODES = ["image", "ref_image", "video", "edit"];
const REF_SLOT_MAX = 9;

const state = {
  clientId: (() => {
    try {
      let id = localStorage.getItem("yi-client-id");
      if (!id) {
        id = "yi-" + Math.random().toString(36).slice(2);
        localStorage.setItem("yi-client-id", id);
      }
      return id;
    } catch (e) {
      return "yi-" + Math.random().toString(36).slice(2);
    }
  })(),
  uiMode: "image",
  aspect: "1:1",
  imageMP: 1.77,
  videoMP: 0.6,
  videoMaxMP: (() => {
    try {
      const n = parseFloat(localStorage.getItem("yi-video-max-mp"));
      if (Number.isFinite(n)) {
        const capped = Math.min(1.03, Math.max(0.2, n));
        if (Math.abs(capped - 0.52) < 0.001) {
          try { localStorage.setItem("yi-video-max-mp", "0.6"); } catch (e) {}
          return 0.6;
        }
        return capped;
      }
    } catch (e) {}
    return 0.6;
  })(),
  duration: 5,
  packs: [],
  loras: [],
  pack: null,
  overrides: {},
  recOn: {},
  extraLoras: [],
  nsfw: false,
  nsfwOn: {},
  initName: null,
  initUrl: null,
  initW: 0,
  initH: 0,
  connected: false,
  wantConnect: true,
  modelsRoot: "",
  comfyRoot: "",
  comfyInstall: null,
  defaults: Object.assign({}, FALLBACK_DEFAULTS),
  prefDraft: null,
  jobs: [],
  viewPackId: null,
  setupNeeded: false,
  running: false,
  submitting: false,
  stopping: false,
  stoppedAt: 0,
  lastPct: 0,
  currentJobKey: null,
  queue: [],
  promptId: null,
  failPid: null,
  ws: null,
  history: [],
  gallery: [],
  libHistory: [],
  libTab: "gallery",
  libQuery: "",
  libKind: "all",
  libSource: "all",
  prefsDirty: false,
  inputRoot: "",
  outputRoot: "",
  shown: null,
  savedShown: null,
  online: false,
  apiBase: "",
  muted: (() => {
    try { return localStorage.getItem("imagine-muted") === "1"; } catch { return false; }
  })(),
  jobPackId: null,
  jobPackTitle: null,
  jobFamily: null,
  jobStartedAt: 0,
  donePids: {},
  lastJob: null,
  liveUrl: "",
  negatives: [],
  negOpen: false,
  railOn: (() => {
    try { return localStorage.getItem("yi-rail") !== "0"; } catch { return true; }
  })(),
  sheetReturn: null,
  privacyLocked: false,
  privacy: null,
  privacyIdleTimer: null,
  privacyClockTimer: null,
  privacyTitle: "",
  hasH3R2V: false,
  progressPhase: "load",
  rewriter: (() => {
    try { return localStorage.getItem("yi-rewriter") || "structure"; } catch { return "structure"; }
  })(),
  llmModels: [{ id: "structure", label: "Structure (built-in)", kind: "builtin", available: true }],
  film: null,
  refs: null,
  diskStories: [],
  autoBetaFromAfterMidnight: false,
};

function selectedRewriter() {
  return state.rewriter || "structure";
}
function persistRewriter(id) {
  const next = id || "structure";
  state.rewriter = next;
  try { localStorage.setItem("yi-rewriter", next); } catch (_) {}
  ["#rewriterPick", "#rewriterPickFilm"].forEach((sel) => {
    const el = $(sel);
    if (el && el.value !== next) el.value = next;
  });
}
function fillRewriterSelects() {
  const models = Array.isArray(state.llmModels) && state.llmModels.length
    ? state.llmModels
    : [{ id: "structure", label: "Structure (built-in)", kind: "builtin" }];
  const ids = new Set(models.map((m) => m.id));
  if (!ids.has(state.rewriter)) persistRewriter("structure");
  ["#rewriterPick", "#rewriterPickFilm"].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    const cur = state.rewriter || "structure";
    el.innerHTML = models.map((m) => {
      const id = String(m.id || "");
      const label = String(m.label || id);
      return `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(label)}</option>`;
    }).join("");
    el.value = cur;
    el.onchange = () => persistRewriter(el.value);
  });
}
async function loadLlmModels() {
  try {
    const j = await apiFetch("/api/llm-models");
    if (j && Array.isArray(j.models) && j.models.length) {
      state.llmModels = j.models;
    }
  } catch (e) {
    console.error(e);
  }
  fillRewriterSelects();
}
function toast(m, err) {
  if (state.privacyLocked) return;
  const t = $("#toast");
  if (!t) {
    console.error(m);
    return;
  }
  t.textContent = m;
  t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toast._t);
  let hold = err ? 8000 : 4000;
  if (/not enough ram/i.test(String(m || ""))) hold = 10000;
  toast._t = setTimeout(() => (t.className = "toast"), hold);
}
function comfy() {
  const el = $("#comfyUrl");
  return ((el && el.value) || "http://127.0.0.1:8188").replace(/\/$/, "");
}
function apiBases() {
  const out = [];
  if (location.protocol === "http:" || location.protocol === "https:") {
    out.push(location.origin);
  }
  out.push("http://127.0.0.1:7860");
  return [...new Set(out)];
}
async function apiFetch(path, opts) {
  opts = opts || {};
  const q = path.indexOf("?") >= 0 ? "&" : "?";
  const suffix = path + q + "comfy=" + encodeURIComponent(comfy());
  let last = new Error("Could not reach Your Imagination at http://127.0.0.1:7860");
  for (const base of apiBases()) {
    try {
      const headers = Object.assign({}, opts.headers || {});
      if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      const r = await fetch(base + suffix, Object.assign({}, opts, { headers, cache: "no-store" }));
      const text = await r.text();
      let j = null;
      try {
        j = text ? JSON.parse(text) : {};
      } catch (e) {
        last = new Error("Your Imagination returned non-JSON from " + base + path);
        continue;
      }
      if (!r.ok) {
        last = new Error((j && j.error) || "HTTP " + r.status);
        continue;
      }
      state.apiBase = base;
      return j;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
function viewUrl(m) {
  const p = new URLSearchParams({ filename: m.filename, subfolder: m.subfolder || "", type: m.type || "output", comfy: comfy() });
  const bust = m.ts || m.mtime || m.prompt_id || "";
  if (bust) p.set("t", String(bust));
  return (state.apiBase || "") + "/api/view?" + p.toString();
}
function hdr() {
  return {};
}
function normalizeUiMode(mode) {
  if (mode === "ref_image") return "ref_image";
  if (mode === "video" || mode === "i2v" || mode === "t2v") return "video";
  if (mode === "edit") return "edit";
  return "image";
}
function genMode() {
  if (state.uiMode === "edit") return "edit";
  if (state.uiMode === "ref_image") return "t2i";
  if (state.uiMode === "video") return state.initName ? "i2v" : "t2v";
  return "t2i";
}
function attachOn() {
  return state.uiMode === "video" || state.uiMode === "edit";
}
function syncAttach() {
  const attach = $("#attach");
  if (attach) attach.classList.toggle("show", attachOn());
}
function h3StillUi() {
  return !!(state.pack && state.pack.family === "h3" && state.uiMode !== "video");
}
function mpRange() {
  if (state.uiMode === "video") {
    const cap = Number(state.videoMaxMP);
    const max = Number.isFinite(cap) ? Math.min(1.03, Math.max(0.2, cap)) : 0.6;
    return { min: 0.2, max, step: 0.02 };
  }
  if (h3StillUi()) return { min: 0.4, max: 1.03, step: 0.02 };
  return { min: 0.5, max: 2.0, step: 0.05 };
}
function currentMP() {
  const r = mpRange();
  const key = state.uiMode === "video" ? "videoMP" : "imageMP";
  let n = Number(state[key]);
  if (!Number.isFinite(n)) n = key === "videoMP" ? 0.6 : (h3StillUi() ? 0.84 : 1.77);
  return Math.min(r.max, Math.max(r.min, n));
}
function setMegapixels(v, from) {
  const r = mpRange();
  let n = parseFloat(v);
  if (!Number.isFinite(n)) n = currentMP();
  n = Math.round(Math.min(r.max, Math.max(r.min, n)) * 100) / 100;
  const key = state.uiMode === "video" ? "videoMP" : "imageMP";
  state[key] = n;
  const mp = $("#mp");
  const num = $("#mpNum");
  const gear = $("#mpGear");
  if (mp && from !== "range") mp.value = String(n);
  if (num && from !== "num") num.value = String(n);
  if (gear && from !== "gear") gear.value = String(n);
  syncSizeReadout();
}
function syncMpControls() {
  const r = mpRange();
  ["mp", "mpNum", "mpGear"].forEach((id) => {
    const el = $("#" + id);
    if (!el) return;
    el.min = r.min;
    el.max = r.max;
    el.step = r.step;
  });
  setMegapixels(currentMP());
}
function aspectRatioValue() {
  let r;
  if (state.aspect === "auto") {
    r = (state.initW && state.initH) ? (state.initW / state.initH) : 1;
  } else {
    r = RATIOS[state.aspect] || 1;
  }
  if (state.pack && state.pack.family === "h3" && state.uiMode === "video" && Math.abs(r - 1) < 0.08) {
    return 16 / 9;
  }
  return r;
}
function size() {
  const mp = currentMP();
  const ratio = aspectRatioValue();
  const target = mp * 1e6;
  const step = (state.pack && state.pack.family === "h3") ? 32 : 16;
  let w = Math.max(step, Math.round(Math.sqrt(target * ratio) / step) * step);
  let h = Math.max(step, Math.round(Math.sqrt(target / ratio) / step) * step);
  return [w, h];
}
function aspectFrameSize(id, max) {
  max = max || 36;
  if (id === "auto") return { w: Math.round(max * 0.72), h: Math.round(max * 0.72), auto: true };
  const r = RATIOS[id] || 1;
  if (r >= 1) return { w: max, h: Math.max(8, Math.round(max / r)) };
  return { w: Math.max(8, Math.round(max * r)), h: max };
}
function paintAspectFrame(el, id, max) {
  if (!el) return;
  max = max || 36;
  let inner = el.querySelector("i");
  if (!inner) {
    inner = document.createElement("i");
    el.appendChild(inner);
  }
  let box;
  if (id === "auto" && state.initW && state.initH) {
    const r = state.initW / state.initH;
    box = r >= 1
      ? { w: max, h: Math.max(8, Math.round(max / r)) }
      : { w: Math.max(8, Math.round(max * r)), h: max };
  } else {
    box = aspectFrameSize(id, max);
  }
  inner.style.width = box.w + "px";
  inner.style.height = box.h + "px";
  inner.classList.toggle("auto", id === "auto" && !(state.initW && state.initH));
}
function closeAspectPop() {
  const pop = $("#aspectPop");
  const btn = $("#aspectBtn");
  if (pop) pop.hidden = true;
  if (btn) btn.classList.remove("open");
}
function syncAspectUi() {
  const btn = $("#aspectBtn");
  const label = $("#aspectLabel");
  const mini = $("#aspectMini");
  const pop = $("#aspectPop");
  const shown = state.aspect === "auto" ? "Auto" : state.aspect;
  if (label) label.textContent = shown;
  if (btn) {
    btn.title = state.aspect === "auto"
      ? (state.initW ? "Auto — matching the attached photo" : "Auto — matches an attached photo, otherwise 1:1")
      : ("Aspect ratio " + state.aspect);
  }
  paintAspectFrame(mini, state.aspect, 16);
  if (pop) {
    [...pop.querySelectorAll("[data-a]")].forEach((b) => {
      b.classList.toggle("on", b.dataset.a === state.aspect);
    });
  }
}
function setAspect(id, opts) {
  opts = opts || {};
  if (id !== "auto" && !RATIOS[id]) return;
  state.aspect = id;
  syncAspectUi();
  syncSizeReadout();
  if (!opts.keepOpen) closeAspectPop();
}
function renderAspectPop() {
  const pop = $("#aspectPop");
  if (!pop) return;
  pop.innerHTML = "";
  ASPECT_CHOICES.forEach((id) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "aspect-opt" + (state.aspect === id ? " on" : "");
    b.dataset.a = id;
    b.title = id === "auto" ? "Match the attached photo. 1:1 if none is attached." : id;
    const cell = document.createElement("span");
    cell.className = "aspect-cell";
    const frame = document.createElement("span");
    frame.className = "aspect-frame";
    frame.appendChild(document.createElement("i"));
    cell.appendChild(frame);
    paintAspectFrame(frame, id, 36);
    const lab = document.createElement("span");
    lab.textContent = id === "auto" ? "Auto" : id;
    b.appendChild(cell);
    b.appendChild(lab);
    b.onclick = (e) => {
      e.stopPropagation();
      setAspect(id);
    };
    pop.appendChild(b);
  });
}
function toggleAspectPop() {
  const pop = $("#aspectPop");
  const btn = $("#aspectBtn");
  if (!pop) return;
  if (!pop.hidden) {
    closeAspectPop();
    return;
  }
  renderAspectPop();
  pop.hidden = false;
  if (btn) btn.classList.add("open");
}
function syncSizeReadout() {
  const [w, h] = size();
  const mp = (w * h) / 1e6;
  const tag = state.aspect === "auto" ? "Auto · " : "";
  const txt = tag + w + "×" + h + " · " + mp.toFixed(2) + "MP";
  const ro = $("#sizeReadout");
  if (ro) ro.textContent = txt;
  const gear = $("#sizeGear");
  if (gear) {
    const note = state.uiMode === "video"
      ? "  (H3: " + currentMP().toFixed(2) + "MP, cap " + mpRange().max.toFixed(2) + " — raise cap in Settings)"
      : "";
    gear.textContent = txt + note;
  }
}
function setDuration(v) {
  let n = parseFloat(v);
  if (!Number.isFinite(n)) n = 5;
  n = Math.min(15, Math.max(1, Math.round(n)));
  state.duration = n;
  const el = $("#duration");
  if (el) el.value = String(n);
  return n;
}

function readDuration() {
  const el = $("#duration");
  return setDuration(el ? el.value : state.duration);
}
function packCanMultiRef(p) {
  return !!(p && p.family === "h3");
}
function r2iPackIsWeak(p) {
  return !!(p && !packCanMultiRef(p));
}
function warnWeakR2I(p) {
  const name = (p && p.title) || "This pack";
  toast(name + " is a weak R2I path — H3 identity refs work better. Generate will still run.", true);
}
function packSupports(p, ui) {
  if (!p) return false;
  const m = p.modes || [];
  if (ui === "edit") return m.includes("edit") || m.includes("i2i");
  if (ui === "video") return m.includes("t2v") || m.includes("i2v");
  if (ui === "ref_image") return m.includes("t2i") || m.includes("i2i");
  return m.includes("t2i") || m.includes("i2i");
}

function packModeHint(p) {
  return packUiModes(p).map((m) => UI_MODE_LABEL[m]).join(" · ");
}

function preferredUiMode(p) {
  if (state.uiMode === "ref_image") {
    if (packSupports(p, "ref_image")) return "ref_image";
    return packUiModes(p)[0] || "image";
  }
  const modes = packUiModes(p);
  if (modes.includes(state.uiMode)) return state.uiMode;
  return modes[0] || state.uiMode;
}
function findReadyPack(pred) {
  const all = state.packs || [];
  const ready = all.filter((p) => p.ready && pred(p));
  return ready[0] || all.find(pred) || null;
}
function findReadyH3() {
  return findReadyPack((p) => p.family === "h3");
}
function ensurePackForUiMode(mode, opts) {
  opts = opts || {};
  const cur = state.pack;
  if (cur && packSupports(cur, mode)) return cur;
  const id = (state.defaults && state.defaults[mode]) || FALLBACK_DEFAULTS[mode] || FALLBACK_DEFAULTS.image;
  const usable = (state.packs || []).filter((p) => packSupports(p, mode));
  const ready = usable.filter((p) => p.ready);
  const hit =
    ready.find((p) => p.id === id) ||
    usable.find((p) => p.id === id) ||
    ready[0] ||
    usable[0];
  if (hit && hit !== cur) {
    selectPack(hit, { silent: true });
    if (opts.toast !== false && cur) {
      toast((UI_MODE_LABEL[mode] || mode) + " needs " + hit.title + " — switched.");
    }
    return hit;
  }
  return cur;
}
function ensureH3ForIdentity(msg) {
  if (state.pack && packCanMultiRef(state.pack)) return true;
  toast(msg || "This needs MiniMax H3 identity refs.", true);
  return false;
}

function setStatus(kind, text) {
  const pill = $("#statusPill");
  const txt = $("#statusTxt");
  if (pill) pill.className = "pill " + (kind || "");
  if (txt) txt.textContent = text;
  if (kind === "ok" || kind === "warn" || kind === "err") syncConnectUi();
}

function applySession(j) {
  if (!j) return;
  if (j.defaults) state.defaults = Object.assign({}, FALLBACK_DEFAULTS, j.defaults);
  state.wantConnect = j.connected !== false;
  state.online = !!j.online;
  state.connected = state.wantConnect && state.online;
  if (j.models_root) state.modelsRoot = j.models_root;
  if (j.comfy_url && $("#comfyUrl") && !$("#comfyUrl").dataset.dirty) {
    $("#comfyUrl").value = j.comfy_url;
  }
  if ($("#modelsRoot") && j.models_root && !($("#gear") && $("#gear").classList.contains("on"))) {
    $("#modelsRoot").value = j.models_root;
  }
  if (j.comfy_root) state.comfyRoot = j.comfy_root;
  if (j.comfy_install) state.comfyInstall = j.comfy_install;
  if ($("#setupUrl") && j.comfy_url) $("#setupUrl").value = j.comfy_url;
  if ($("#setupPath") && j.models_root && !$("#setupPath").value) $("#setupPath").value = j.models_root;
  state.jobs = j.download_jobs || state.jobs || [];
  state.setupNeeded = !!j.setup_needed;
  syncConnectUi();
  renderComfySetup();
}

function syncConnectUi() {
  const on = !!(state.wantConnect && state.online);
  const waiting = !!(state.wantConnect && !state.online);

  const dot = $("#brandDot");
  if (dot) {
    dot.classList.toggle("ok", on);
    dot.title = on ? "ComfyUI connected" : "ComfyUI disconnected";
  }

  const btn = $("#connectBtn");
  if (btn) {
    btn.textContent = on ? "Disconnect" : (state.wantConnect ? "Retry" : "Connect");
    btn.classList.toggle("on", on);
  }

  const rec = $("#reconnect");
  if (rec) {
    rec.textContent = on ? "Reconnect" : "Connect";
    rec.classList.toggle("on", on);
  }

  const sc = $("#settingsConnect");
  if (sc) {
    sc.textContent = on ? "Connected" : (waiting ? "Retry" : "Connect");
    sc.classList.toggle("on", on);
  }
  const sd = $("#settingsDisconnect");
  if (sd) sd.disabled = !state.wantConnect;

  const disc = $("#disconnectBtn");
  if (disc) disc.disabled = !state.wantConnect;

  const note = $("#settingsConnNote");
  if (note) {
    note.className = "conn-note" + (on ? " ok" : waiting ? " err" : "");
    if (on) note.textContent = "Connected to ComfyUI.";
    else if (waiting) note.textContent = "Not connected — ComfyUI is not answering. Open Settings → ComfyUI to set the folder or start it.";
    else note.textContent = "Disconnected. Connect when you want to generate.";
  }

  const pill = $("#statusPill");
  const txt = $("#statusTxt");
  if (!state.wantConnect) {
    if (pill) pill.className = "pill warn";
    if (txt) txt.textContent = "disconnected";
  } else if (on) {
    if (pill) pill.className = "pill ok";
    if (txt) txt.textContent = "connected";
  } else {
    if (pill) pill.className = "pill err";
    if (txt) txt.textContent = "comfy offline";
  }
}

function renderComfySetup() {
  const inst = state.comfyInstall || {};
  const root = state.comfyRoot || inst.root || "";
  const online = !!(state.wantConnect && state.online);
  let text = "Checking ComfyUI…";
  let kind = "";
  if (online) {
    text = root
      ? "ComfyUI is running. Path: " + root
      : "ComfyUI is running at " + comfy() + ".";
    kind = "ok";
  } else if (inst.status === "found" || inst.can_start) {
    text = (inst.label || "ComfyUI is installed but offline.") + (root ? " Path: " + root : "");
    kind = "err";
  } else if (inst.status === "invalid") {
    text = inst.label || "That folder is not a ComfyUI install.";
    kind = "err";
  } else {
    text = "ComfyUI is not installed. Download the official portable (~2 GB), extract it, set that folder, then Start Comfy. The app stays usable for Film and Settings without it.";
    kind = "err";
  }
  ["settingsComfyNote", "setupComfyNote"].forEach((id) => {
    const el = $("#" + id);
    if (!el) return;
    el.className = "conn-note" + (kind ? " " + kind : "");
    el.textContent = text;
  });
  ["settingsComfyRoot", "setupComfyRoot"].forEach((id) => {
    const el = $("#" + id);
    if (el && root && !el.dataset.dirty) el.value = root;
  });
}

async function saveComfyRootFrom(el) {
  const raw = ((el && el.value) || "").trim();
  if (!raw) {
    toast("Pick the ComfyUI portable folder first.", true);
    return null;
  }
  const j = await apiFetch("/api/config", {
    method: "POST",
    body: JSON.stringify({ comfy_root: raw }),
  });
  applySession(j);
  toast("ComfyUI folder saved.");
  return j;
}

async function startComfyFromUi(el) {
  const raw = ((el && el.value) || state.comfyRoot || "").trim();
  try {
    const j = await apiFetch("/api/comfy/start", {
      method: "POST",
      body: JSON.stringify({ comfy_root: raw }),
    });
    applySession(j);
    if (j.already) toast("ComfyUI is already running.");
    else toast("Starting ComfyUI. The pill turns green when it finishes loading.");
    startConnectWatch();
    if (!state.wantConnect) await connectComfy({ quiet: true });
    return j;
  } catch (e) {
    toast(e.message || "Could not start ComfyUI.", true);
  }
}

function startConnectWatch() {
  if (startConnectWatch._t) return;
  startConnectWatch._t = setInterval(async () => {
    if (!state.wantConnect || state.online) return;
    if (startConnectWatch._busy) return;
    startConnectWatch._busy = true;
    try {
      await connectComfy({ quiet: true });
    } catch (_) {}
    startConnectWatch._busy = false;
  }, 4000);
}

function packUiModes(p) {
  const m = p.modes || [];
  const out = [];
  if (m.includes("t2i") || m.includes("i2i")) out.push("image");
  if (m.includes("t2v") || m.includes("i2v")) out.push("video");
  if (m.includes("edit")) out.push("edit");
  return out;
}

function defaultBadges(p) {
  return packUiModes(p).filter((mode) => state.defaults[mode] === p.id);
}

async function scan(opts) {
  opts = opts || {};
  setStatus("", "scanning…");
  try {
    const j = await apiFetch("/api/scan");
    applySession(j);
    loadLlmModels().catch((e) => console.error(e));
    state.packs = j.packs || [];
    state.loras = j.loras || [];
    state.hasH3R2V = !!j.has_h3_r2v;
    if (typeof renderFilmHint === "function") renderFilmHint();
    try {
      fillSelect($("#sampler"), j.samplers || ["euler"], false);
      fillSelect($("#scheduler"), j.schedulers || ["simple"], false);
      if (state.autoBetaFromAfterMidnight || afterMidnightPicked()) {
        ensureSelectOption($("#scheduler"), "beta");
      }
      if (state.autoBetaFromAfterMidnight && $("#scheduler")) $("#scheduler").value = "beta";
      renderPacks();
      renderNew(j.new_files || []);
      if ($("#gear") && $("#gear").classList.contains("on")) renderPrefModels();
      if (!state.pack || !state.packs.find((p) => p.id === state.pack.id)) {
        pickDefault();
      } else {
        const fresh = state.packs.find((p) => p.id === state.pack.id);
        if (fresh) selectPack(fresh, { keepExtras: true, silent: true });
      }
    } catch (uiErr) {
      console.error(uiErr);
    }
    if (j.setup_needed && !opts.skipSetup) showSetup(true);
    if (state.wantConnect && state.online) {
      try { openSocket(); } catch (wsErr) { console.error(wsErr); }
    } else if (state.wantConnect && !opts.skipConnect) {
      closeSocket();
      try { await connectComfy({ quiet: true }); } catch (_) {}
    } else {
      closeSocket();
    }
    if (!opts.quiet && state.wantConnect && !state.online) {
      toast("ComfyUI is not running at " + comfy() + ". Open Settings → ComfyUI to install or start it.", true);
    }
    syncDlPoll();
    await loadLibrary().catch((e) => console.error(e));
    if ($("#inspector") && $("#inspector").classList.contains("on")) renderInspector();
    await resumeRun().catch((e) => console.error(e));
    return j;
  } catch (e) {
    console.error(e);
    state.online = false;
    syncConnectUi();
    toast(e && e.message ? e.message : "Could not reach Your Imagination backend.", true);
  }
}

function fillSelect(sel, list, keepFirst) {
  if (!sel) return;
  const cur = sel.value;
  const first = keepFirst ? sel.querySelector("option") : null;
  sel.innerHTML = "";
  if (first) sel.appendChild(first);
  (Array.isArray(list) ? list : []).forEach((v) => {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = String(v);
    sel.appendChild(o);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function ensureSelectOption(sel, value) {
  if (!sel || value == null || value === "") return;
  const v = String(value);
  if (![...sel.options].some((o) => o.value === v)) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  }
}

function afterMidnightPicked() {
  return !!(state.nsfwOn && state.nsfwOn.aftermidnight);
}

function cowgirlFilePicked() {
  if (state.nsfwOn && state.nsfwOn.cowgirl) return true;
  return (state.extraLoras || []).some((l) => /cowgirl/i.test((l && l.name) || ""));
}

function clipWantsCowgirl(clip) {
  if (sceneLoraId(clip && (clip.sceneLora || clip.scene_lora)) === "cowgirl") return true;
  return cowgirlFilePicked();
}

function r2vJobLikely() {
  if (!(state.pack && state.pack.family === "h3")) return false;
  if (state.uiMode === "ref_image") return true;
  if (typeof hasRef2va === "function" && hasRef2va()) {
    if (cowgirlFilePicked() && (state.uiMode === "video" || (state.film && state.film.view))) return true;
    if (state.film && state.film.view) {
      const clip = state.film.clips[state.film.selected];
      if (clipWantsCowgirl(clip)) return true;
    }
  }
  if (state.uiMode === "video" && !state.initName) {
    const n = (typeof composerRefNames === "function") ? composerRefNames().length : 0;
    const filmN = (state.film && state.film.view && typeof filmRefs === "function") ? filmRefs().length : 0;
    return n > 0 || filmN > 0;
  }
  return false;
}
function syncAfterMidnightScheduler() {
  const sched = $("#scheduler");
  const samp = $("#sampler");
  if (afterMidnightPicked() && r2vJobLikely()) {
    ensureSelectOption(sched, "beta");
    if (sched && sched.value !== "beta") {
      sched.value = "beta";
      state.autoBetaFromAfterMidnight = true;
    }
    const sampOk = samp && samp.value && [...samp.options].some((o) => o.value === samp.value);
    if (samp && !sampOk) {
      ensureSelectOption(samp, "euler");
      samp.value = "euler";
    }
  } else if (state.autoBetaFromAfterMidnight) {
    if (sched && sched.value === "beta") {
      ensureSelectOption(sched, "simple");
      sched.value = "simple";
    }
    state.autoBetaFromAfterMidnight = false;
  }
}

function pickDefault() {
  const id = (state.defaults && state.defaults[state.uiMode]) || FALLBACK_DEFAULTS[state.uiMode];
  const usable = state.packs.filter((p) => packSupports(p, state.uiMode));
  const ready = usable.filter((p) => p.ready);
  const hit =
    ready.find((p) => p.id === id) ||
    usable.find((p) => p.id === id) ||
    ready[0] ||
    usable[0];
  if (hit) selectPack(hit, { silent: true });
  else renderChip();
}

function applyH3ModeSettings() {
  const p = state.pack;
  if (!p || p.family !== "h3") return;
  const still = state.uiMode !== "video";
  const r2v = r2vJobLikely();
  (p.recommended_loras || []).forEach((l) => {
    if (l.id === "turbo8" || l.id === "turbo4") {
      state.recOn[l.id] = (!still && !r2v) ? (!!l.on && !l.missing) : false;
    }
    if (l.id === "turbo_ref4") state.recOn[l.id] = false;
  });
  if (still) {
    $("#steps").value = 20;
    $("#cfg").value = 1;
    if (Number(state.imageMP) > 1.03) state.imageMP = 0.84;
    if (!Number.isFinite(Number(state.imageMP)) || Number(state.imageMP) < 0.4) state.imageMP = 0.84;
  } else {
    const d = p.defaults || {};
    if (d.steps) $("#steps").value = d.steps;
    if (d.cfg != null) $("#cfg").value = d.cfg;
  }
}
function applyModeSettings() {
  const p = state.pack;
  if (!p) return;
  if (p.family === "h3") {
    applyH3ModeSettings();
    if (state.nsfw && afterMidnightPicked()) syncAfterMidnightScheduler();
    renderInspector();
    return;
  }
  const d = p.defaults || {};
  if (d.steps) $("#steps").value = d.steps;
  if (d.cfg != null) $("#cfg").value = d.cfg;
  if (d.denoise != null) $("#denoise").value = d.denoise;
  if (d.sampler) $("#sampler").value = d.sampler;
  if (d.scheduler) $("#scheduler").value = d.scheduler;
  if (p.graph === "qwen_edit" && state.recOn.lightning4) {
    $("#steps").value = 8;
    $("#cfg").value = 1;
  }
  renderInspector();
}

function activatePack(p, opts) {
  opts = opts || {};
  if (!p) return;
  const mode = preferredUiMode(p);
  const switched = mode !== state.uiMode;
  if (switched) setUiMode(mode, { keepPack: true });
  selectPack(p, { silent: switched });
  if (switched) toast(p.title + " is for " + (UI_MODE_LABEL[mode] || mode) + " — switched.");
  if (!p.ready && !opts.skipInspector) openInspector();
}

function selectPack(p, opts) {
  opts = opts || {};
  state.pack = p;
  if (!opts.keepExtras) {
    state.overrides = {};
    state.extraLoras = [];
  }
  state.recOn = {};
  state.nsfwOn = {};
  state.autoBetaFromAfterMidnight = false;
  (p.recommended_loras || []).forEach((l) => {
    state.recOn[l.id] = !!l.on && !l.missing;
  });
  (p.nsfw_loras || []).forEach((l) => {
    state.nsfwOn[l.id] = !!l.on && !l.missing;
  });
  applyH3ModeSettings();
  syncSceneLoraChips();
  const d = p.defaults || {};
  if (d.steps && !h3StillUi()) $("#steps").value = d.steps;
  if (d.cfg != null && !h3StillUi()) $("#cfg").value = d.cfg;
  if (d.denoise != null) $("#denoise").value = d.denoise;
  if (d.sampler) $("#sampler").value = d.sampler;
  if (d.scheduler) $("#scheduler").value = d.scheduler;
  if (state.nsfw && afterMidnightPicked()) syncAfterMidnightScheduler();
  if (d.duration != null) setDuration(d.duration);
  if (p.graph === "qwen_edit" && state.recOn.lightning4) {
    $("#steps").value = 8;
    $("#cfg").value = 1;
  }
  renderChip();
  renderInspector();
  if (!opts.silent) {
    if (state.uiMode === "ref_image" && r2iPackIsWeak(p)) warnWeakR2I(p);
    else toast(p.title + (p.ready ? " loaded." : " — missing files."));
  }
  if (p.family === "h3" && state.uiMode === "video" && state.aspect === "1:1") {
    setAspect("16:9", { keepOpen: true });
  }
  syncMpControls();
}

function renderChip() {
  const p = state.pack;
  const chip = $("#packChip");
  if (!chip) return;
  if (!p) {
    $("#packName").textContent = "Choose a model";
    chip.classList.remove("missing");
    renderPackMenu();
    return;
  }
  $("#packName").textContent = p.title;
  chip.classList.toggle("missing", !p.ready);
  $("#packSwatch").textContent = p.ready ? "●" : "!";
  renderPackMenu();
}

function packMenuOpen() {
  const menu = $("#packMenu");
  return !!(menu && !menu.hidden);
}

function closePackMenu() {
  const menu = $("#packMenu");
  const chip = $("#packChip");
  if (menu) menu.hidden = true;
  if (chip) chip.classList.remove("open");
}

function togglePackMenu() {
  const menu = $("#packMenu");
  if (!menu) return;
  if (!menu.hidden) {
    closePackMenu();
    return;
  }
  renderPackMenu();
  menu.hidden = false;
  $("#packChip").classList.add("open");
}

function renderPackMenu() {
  const menu = $("#packMenu");
  if (!menu) return;
  const all = state.packs || [];
  const matching = all.filter((p) => packSupports(p, state.uiMode));
  const rest = all.filter((p) => !packSupports(p, state.uiMode));
  menu.innerHTML = "";
  if (!all.length) {
    const empty = document.createElement("div");
    empty.className = "pm-sub";
    empty.style.padding = "8px 10px";
    empty.textContent = "No models installed yet.";
    menu.appendChild(empty);
  }
  function addHead(label) {
    const h = document.createElement("div");
    h.className = "pm-head";
    h.textContent = label;
    menu.appendChild(h);
  }
  function addPackBtn(p) {
    const fit = packSupports(p, state.uiMode);
    const b = document.createElement("button");
    b.type = "button";
    b.className = state.pack && state.pack.id === p.id ? "on" : "";
    const hint = packModeHint(p);
    const extra = fit ? "" : " · switches to " + (UI_MODE_LABEL[preferredUiMode(p)] || "its mode");
    b.innerHTML =
      `<div class="pm-title">${esc(p.title)}${p.ready ? "" : " · missing files"}</div>` +
      `<div class="pm-sub">${esc(hint)}${esc(extra)}${p.blurb ? " · " + esc(p.blurb) : ""}</div>`;
    b.onclick = (e) => {
      e.stopPropagation();
      closePackMenu();
      activatePack(p);
    };
    menu.appendChild(b);
  }
  matching.forEach(addPackBtn);
  if (rest.length) {
    addHead("Other models");
    rest.forEach(addPackBtn);
  }
  const foot = document.createElement("button");
  foot.type = "button";
  foot.className = "pm-foot";
  foot.textContent = "Manage models…";
  foot.onclick = (e) => {
    e.stopPropagation();
    closePackMenu();
    openSheet();
  };
  menu.appendChild(foot);
}

const RAIL_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>';

function applyRail() {
  document.body.classList.toggle("rail-off", !state.railOn);
  const btn = $("#railBtn");
  if (btn) {
    btn.innerHTML = RAIL_ICON;
    const label = state.railOn ? "Hide recent images" : "Show recent images";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

function toggleRail() {
  state.railOn = !state.railOn;
  try { localStorage.setItem("yi-rail", state.railOn ? "1" : "0"); } catch (_) {}
  applyRail();
}

function setNegOpen(on) {
  state.negOpen = !!on;
  const box = $("#neg");
  const tog = $("#negToggle");
  if (box) box.classList.toggle("show", state.negOpen);
  if (tog) tog.classList.toggle("on", state.negOpen);
}

function currentNeg() {
  const el = $("#neg");
  return el ? el.value.trim() : "";
}

function renderNegPick() {
  const sel = $("#negPick");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">Saved negatives</option>`;
  (state.negatives || []).forEach((it) => {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = it.name;
    sel.appendChild(o);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

async function loadNegatives() {
  try {
    const j = await apiFetch("/api/negatives");
    state.negatives = j.items || [];
  } catch (_) {
    try {
      state.negatives = JSON.parse(localStorage.getItem("yi-negatives") || "[]");
    } catch (e) {
      state.negatives = [];
    }
  }
  if (!state.negatives.length) {
    state.negatives = [
      { id: "quality", name: "Quality", text: "blurry, low quality, jpeg artifacts, watermark, text, logo, extra fingers, deformed hands" },
      { id: "clean", name: "Clean photo", text: "illustration, cartoon, cgi, plastic skin, oversharpened" },
    ];
  }
  renderNegPick();
  try {
    const saved = localStorage.getItem("yi-neg");
    if (saved && $("#neg") && !$("#neg").value) $("#neg").value = saved;
  } catch (_) {}
}

async function persistNegatives() {
  try { localStorage.setItem("yi-negatives", JSON.stringify(state.negatives)); } catch (_) {}
  try {
    const j = await apiFetch("/api/negatives", {
      method: "POST",
      body: JSON.stringify({ items: state.negatives }),
    });
    if (j && j.items) state.negatives = j.items;
  } catch (_) {}
  renderNegPick();
}

async function saveCurrentNeg() {
  const text = currentNeg();
  if (!text) {
    toast("Write a negative prompt first.", true);
    return;
  }
  const name = window.prompt("Name this negative prompt", "My negative");
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "neg";
  const existing = state.negatives.find((x) => x.id === id || x.name === name.trim());
  if (existing) {
    existing.name = name.trim();
    existing.text = text;
  } else {
    state.negatives.push({ id, name: name.trim(), text });
  }
  await persistNegatives();
  const sel = $("#negPick");
  if (sel) sel.value = existing ? existing.id : id;
  setNegOpen(false);
  toast("Saved “" + name.trim() + "”.");
}

async function deleteSelectedNeg() {
  const sel = $("#negPick");
  const id = sel && sel.value;
  if (!id) {
    toast("Pick a saved negative first.", true);
    return;
  }
  const hit = state.negatives.find((x) => x.id === id);
  if (!hit) return;
  if (!window.confirm("Delete saved negative “" + hit.name + "”?")) return;
  state.negatives = state.negatives.filter((x) => x.id !== id);
  await persistNegatives();
  toast("Deleted.");
}

function applyNegPick() {
  const sel = $("#negPick");
  const id = sel && sel.value;
  const hit = (state.negatives || []).find((x) => x.id === id);
  if (!hit) return;
  if ($("#neg")) $("#neg").value = hit.text;
  setNegOpen(true);
  try { localStorage.setItem("yi-neg", hit.text); } catch (_) {}
}

function combinedNeg(pack) {
  const user = currentNeg();
  const packNeg = (pack && pack.defaults && pack.defaults.neg) || "";
  if (user && packNeg && user !== packNeg) return packNeg + ", " + user;
  return user || packNeg;
}

function snapshotSettings(p) {
  p = p || {};
  return {
    pack: p.pack_id || (state.pack && state.pack.id) || "",
    pack_title: p.pack_title || (state.pack && state.pack.title) || "",
    prompt: p.prompt || ($("#idea") && $("#idea").value) || "",
    neg: p.neg || currentNeg(),
    steps: p.steps || ($("#steps") && $("#steps").value) || "",
    cfg: p.cfg || ($("#cfg") && $("#cfg").value) || "",
    denoise: p.denoise || ($("#denoise") && $("#denoise").value) || "",
    sampler: p.sampler || ($("#sampler") && $("#sampler").value) || "",
    scheduler: p.scheduler || ($("#scheduler") && $("#scheduler").value) || "",
    seed: p.seed || ($("#seed") && $("#seed").value) || "",
    width: p.width,
    height: p.height,
    megapixels: p.megapixels || currentMP(),
    duration: p.duration || state.duration,
    aspect: state.aspect,
    mode: p.mode || genMode(),
    ui_mode: state.uiMode,
    nsfw: !!state.nsfw,
    film_clip: p.film_clip || null,
    film_still: !!p.film_still,
    h3_path: p.h3_path || "",
    init_image: p.init_image || null,
    last_image: p.last_image || null,
  };
}

function applySettings(s, opts) {
  opts = opts || {};
  if (!s) return;
  if (s.ui_mode || s.mode) setUiMode(s.ui_mode || s.mode);
  if (s.pack) {
    const pack = (state.packs || []).find((x) => x.id === s.pack);
    if (pack) selectPack(pack, { silent: true });
  }
  if (s.prompt && $("#idea")) $("#idea").value = s.prompt;
  if (s.neg != null && $("#neg")) {
    $("#neg").value = s.neg;
    if (s.neg) setNegOpen(true);
  }
  if (s.steps && $("#steps")) $("#steps").value = s.steps;
  if (s.cfg != null && $("#cfg")) $("#cfg").value = s.cfg;
  if (s.denoise != null && $("#denoise")) $("#denoise").value = s.denoise;
  if (s.sampler && $("#sampler")) $("#sampler").value = s.sampler;
  if (s.scheduler && $("#scheduler")) $("#scheduler").value = s.scheduler;
  if (s.seed != null && $("#seed")) $("#seed").value = s.seed;
  if (s.duration) setDuration(s.duration);
  if (s.aspect) setAspect(s.aspect, { keepOpen: true });
  if (s.nsfw != null) {
    state.nsfw = !!s.nsfw;
    const chip = $("#nsfwChip");
    if (chip) chip.classList.toggle("on", state.nsfw);
  }
  if (state.nsfw && afterMidnightPicked()) syncAfterMidnightScheduler();
  if (s.megapixels) setMegapixels(s.megapixels);
  if (opts.asInit && opts.item) attachResult(opts.item, { animate: false });
  toast("Settings loaded.");
}

function hideLivePreview() {
  const el = $("#livePreview");
  if (el) {
    el.hidden = true;
    el.removeAttribute("src");
  }
  if (state.liveUrl) {
    try { URL.revokeObjectURL(state.liveUrl); } catch (_) {}
    state.liveUrl = "";
  }
}

function decodeComfyPreview(b64) {
  try {
    const bin = atob(b64);
    const raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    if (raw.length < 8) return null;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const kind = view.getUint32(0);
    let start = 8;
    if (kind === 1) start = 8;
    else if (kind === 4) start = 8 + view.getUint32(4);
    else start = 0;
    const slice = raw.subarray(Math.min(start, raw.length));
    if (slice.length < 4) return null;
    let mime = "image/jpeg";
    if (slice[0] === 0x89 && slice[1] === 0x50) mime = "image/png";
    else if (slice[0] === 0xff && slice[1] === 0xd8) mime = "image/jpeg";
    else if (slice[0] === 0x52 && slice[1] === 0x49) mime = "image/webp";
    return URL.createObjectURL(new Blob([slice], { type: mime }));
  } catch (_) {
    return null;
  }
}

function showLivePreview(b64) {
  const url = decodeComfyPreview(b64);
  if (!url) return;
  if (state.liveUrl) {
    try { URL.revokeObjectURL(state.liveUrl); } catch (_) {}
  }
  state.liveUrl = url;
  if (state.shown && !isCurrentJobItem(state.shown)) return;
  const el = $("#livePreview");
  if (!el) return;
  el.src = url;
  el.hidden = false;
  const ph = $("#placeholder");
  if (ph) ph.style.display = "none";
}

function renderPacks() {
  const grid = $("#packGrid");
  if (!grid) return;
  grid.innerHTML = "";
  (state.packs || []).forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card" + (state.pack && state.pack.id === p.id ? " on" : "") + (p.ready ? "" : " off");
    const defs = defaultBadges(p).map((m) => `<span class="badge def">${esc(UI_MODE_LABEL[m])} default</span>`).join("");
    const modes = packModeHint(p);
    b.innerHTML =
      `<div class="t">${esc(p.title)}</div>` +
      `<div class="b">${esc(p.blurb)}</div>` +
      `<div class="meta"><span class="badge ${p.ready ? "ready" : "wait"}">${p.ready ? "ready" : "missing files"}</span>${modes ? `<span class="badge">${esc(modes)}</span>` : ""}${defs}</div>`;
      b.onclick = () => {
        const backToInsp = state.sheetReturn === "inspector";
        activatePack(p, { skipInspector: true });
        closeSheet();
        if (!p.ready && !backToInsp) openInspector();
      };
    grid.appendChild(b);
  });
}

function beginPrefDraft() {
  state.prefDraft = {
    defaults: Object.assign({}, FALLBACK_DEFAULTS, state.defaults || {}),
    modelsRoot: ( $("#modelsRoot") && $("#modelsRoot").value ) || state.modelsRoot || "",
    comfyUrl: comfy(),
  };
  const root = $("#modelsRoot");
  if (root && !root.value && state.modelsRoot) root.value = state.modelsRoot;
  state.prefsDirty = false;
  renderPrefModels();
}

function renderPrefModels() {
  const el = $("#prefModels");
  if (!el) return;
  const draft = state.prefDraft || { defaults: Object.assign({}, state.defaults) };
  let html = "";
  ["image", "video", "edit"].forEach((mode) => {
    const packs = state.packs.filter((p) => packSupports(p, mode));
    html += `<div class="field"><label>Default ${esc(UI_MODE_LABEL[mode])} model</label>`;
    if (!packs.length) {
      html += `<div style="color:var(--faint);font-size:12px">No packs for ${esc(UI_MODE_LABEL[mode])} yet.</div></div>`;
      return;
    }
    html += `<select class="pref-select" data-mode="${mode}"><option value="">Choose a model</option>`;
    packs.forEach((p) => {
      const sel = (draft.defaults[mode] || "") === p.id ? " selected" : "";
      html += `<option value="${esc(p.id)}"${sel}>${esc(p.title)}${p.ready ? "" : " (missing files)"}</option>`;
    });
    html += `</select></div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll("select").forEach((inp) => {
    inp.onchange = () => {
      if (!state.prefDraft) beginPrefDraft();
      state.prefDraft.defaults[inp.dataset.mode] = inp.value;
      state.prefsDirty = true;
    };
  });
}

async function saveUserPrefs() {
  if (!state.prefDraft) beginPrefDraft();
  const rootEl = $("#modelsRoot");
  const urlEl = $("#comfyUrl");
  const modelsRoot = (rootEl && rootEl.value.trim()) || state.prefDraft.modelsRoot || "";
  const comfyUrl = (urlEl && urlEl.value.trim()) || comfy();
  const defaults = Object.assign({}, FALLBACK_DEFAULTS, state.prefDraft.defaults);
  try {
    const j = await apiFetch("/api/config", {
      method: "POST",
      body: JSON.stringify({
        comfy_url: comfyUrl,
        models_root: modelsRoot,
        defaults,
      }),
    });
    applySession(j);
    state.defaults = Object.assign({}, FALLBACK_DEFAULTS, j.defaults || defaults);
    state.prefDraft = {
      defaults: Object.assign({}, state.defaults),
      modelsRoot: j.models_root || modelsRoot,
      comfyUrl: j.comfy_url || comfyUrl,
    };
    if (rootEl && state.modelsRoot) rootEl.value = state.modelsRoot;
    toast("User preferences saved.");
    state.prefsDirty = false;
    await scan({ quiet: true, skipSetup: true });
    pickDefault();
    renderPrefModels();
  } catch (e) {
    toast(e.message || "Could not save preferences.", true);
  }
}

function openPackDetail(id) {
  state.viewPackId = id;
  const list = $("#packList");
  const detail = $("#packDetail");
  const back = $("#packBack");
  const title = $("#packSheetTitle");
  if (list) list.style.display = "none";
  if (detail) detail.classList.add("on");
  if (back) back.hidden = false;
  const p = state.packs.find((x) => x.id === id);
  if (title) title.textContent = p ? p.title : "Model";
  renderPackDetail(id);
}

function closePackDetail() {
  state.viewPackId = null;
  const list = $("#packList");
  const detail = $("#packDetail");
  const back = $("#packBack");
  const title = $("#packSheetTitle");
  if (list) list.style.display = "";
  if (detail) {
    detail.classList.remove("on");
    detail.innerHTML = "";
  }
  if (back) back.hidden = true;
  if (title) title.textContent = "Model manager";
  renderPacks();
}

function jobFor(packId, assetId) {
  return (state.jobs || []).find((j) => j.pack_id === packId && j.asset_id === assetId && (j.status === "queued" || j.status === "running" || j.status === "cancelling"));
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function renderPackDetail(id) {
  const p = state.packs.find((x) => x.id === id);
  const el = $("#packDetail");
  if (!el || !p) return;
  const modes = packUiModes(p);
  const assets = p.assets || [];
  const groups = [
    { kind: "required", title: "Required" },
    { kind: "recommended", title: "Recommended" },
    { kind: "nsfw", title: "NSFW / optional" },
  ];
  let html = `<p style="color:var(--dim);font-size:13px;line-height:1.5;margin:0">${esc(p.blurb)}</p>`;
  html += `<div class="def-row"><span>Set as default</span>`;
  modes.forEach((mode) => {
    const on = state.defaults[mode] === p.id;
    html += `<button type="button" class="def-btn${on ? " on" : ""}" data-def-mode="${mode}">${esc(UI_MODE_LABEL[mode])}${on ? " · default" : ""}</button>`;
  });
  html += `</div>`;
  groups.forEach((g) => {
    const rows = assets.filter((a) => a.kind === g.kind);
    if (!rows.length) return;
    html += `<div class="sec">${g.title}</div>`;
    rows.forEach((a) => {
      const job = jobFor(p.id, a.id);
      const dest = (a.folder || "") + "/" + (a.filename || "");
      let action = "";
      if (a.installed) action = `<span class="badge ready">installed</span>`;
      else if (job) {
        const pct = job.total ? Math.round(100 * job.bytes / job.total) : 0;
        action = `<button type="button" class="ghost" data-cancel="${esc(job.id)}">Cancel</button>`;
      } else if (a.has_url) action = `<button type="button" class="ghost" data-dl="${esc(a.id)}">Download</button>`;
      else if (a.page) action = `<a class="ghost" href="${esc(a.page)}" target="_blank" rel="noopener">Open page</a>`;
      else action = `<span class="badge wait">drop in folder</span>`;
      html += `<div class="asset">`;
      html += `<div><div class="nm">${esc(a.label)}</div><div class="sub">${esc(a.note || "")} → <code>${esc(dest)}</code></div></div>`;
      html += `<div>${action}</div>`;
      if (job) {
        const pct = job.total ? Math.min(100, Math.round(100 * job.bytes / job.total)) : 0;
        html += `<div class="bar"><i style="width:${pct}%"></i></div>`;
        html += `<div class="sub">${fmtBytes(job.bytes)}${job.total ? " / " + fmtBytes(job.total) : ""} · ${job.status}</div>`;
      } else if (job === undefined) {
        const done = (state.jobs || []).find((j) => j.pack_id === p.id && j.asset_id === a.id);
        if (done && done.status === "error") html += `<div class="sub" style="grid-column:1/-1;color:var(--bad)">${esc(done.error)}</div>`;
      }
      html += `</div>`;
    });
  });
  html += `<div class="setup-actions" style="margin-top:8px">`;
  html += `<button type="button" class="ghost" id="detailLoras">LoRAs & files</button>`;
  html += `<button type="button" class="goish" id="usePack">Use this pack</button>`;
  html += `</div>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-def-mode]").forEach((btn) => {
    btn.onclick = () => setModeDefault(p.id, btn.dataset.defMode);
  });
  el.querySelectorAll("[data-dl]").forEach((btn) => {
    btn.onclick = () => startDownload(p.id, btn.dataset.dl);
  });
  el.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.onclick = () => cancelDownload(btn.dataset.cancel);
  });
  const use = el.querySelector("#usePack");
  if (use) use.onclick = () => {
    selectPack(p);
    closeSheet();
    openInspector();
  };
  const lor = el.querySelector("#detailLoras");
  if (lor) lor.onclick = () => {
    selectPack(p, { silent: true });
    openInspector();
  };
}

async function setModeDefault(packId, mode) {
  try {
    const j = await apiFetch("/api/defaults", {
      method: "POST",
      body: JSON.stringify({ pack_id: packId, mode }),
    });
    state.defaults = Object.assign({}, FALLBACK_DEFAULTS, j.defaults || {});
    if (state.uiMode === mode) pickDefault();
    renderPacks();
    renderPackDetail(packId);
    toast(UI_MODE_LABEL[mode] + " default is now " + (state.packs.find((p) => p.id === packId) || {}).title + ".");
  } catch (e) {
    toast(e.message || "Could not save default.", true);
  }
}

function renderNew(list) {
  const el = $("#newFiles");
  if (!list.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    "<strong>New files not in a pack</strong>" +
    list.map((f) => `<div>${esc(f.folder)} / ${esc(f.name)} · ${esc(f.guess)}</div>`).join("");
}

function resolved() {
  const p = state.pack;
  const r = Object.assign({}, p.resolved || {}, state.overrides);
  return r;
}

function pickClip() {
  const r = resolved();
  const p = state.pack;
  if (!state.nsfw || !p || p.graph !== "flux2_klein") return r.clip;
  const cands = (p.candidates && p.candidates.clip) || [];
  const hit = cands.find((n) => /heretic|uncensored|abliterat/i.test(n || ""));
  return hit || r.clip;
}

function promptLooksExplicit(text) {
  return /\b(nude|naked|nsfw|sex|pussy|vagina|vulva|labia|clit|penis|cock|dick|balls|scrotum|anus|asshole|cum)\b/i.test(text || "");
}

const SCENE_LORA_IDS = ["masturbation", "fingering", "cowgirl"];

function sceneLoraId(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "masturbation" || s === "hmmasturbation" || s === "hm") return "masturbation";
  if (s === "fingering" || s === "finger") return "fingering";
  if (s === "cowgirl") return "cowgirl";
  return "";
}

function filmClipById(id) {
  if (!id || !state.film) return null;
  return (state.film.clips || []).find((c) => c.id === id) || null;
}

function activeSceneLora(over) {
  over = over || {};
  const fromOver = sceneLoraId(over.scene_lora);
  if (fromOver) return fromOver;
  if (over.film_clip) {
    return sceneLoraId((filmClipById(over.film_clip) || {}).sceneLora);
  }
  if (state.film && state.film.view) {
    const clip = state.film.clips[state.film.selected];
    return sceneLoraId(clip && clip.sceneLora);
  }
  if (!state.nsfw) return "";
  if (state.nsfwOn.cowgirl) return "cowgirl";
  if (state.nsfwOn.fingering) return "fingering";
  if (state.nsfwOn.masturbation) return "masturbation";
  return "";
}

function setSceneLora(id) {
  const scene = sceneLoraId(id);
  SCENE_LORA_IDS.forEach((k) => { state.nsfwOn[k] = k === scene; });
  if (scene) state.nsfwOn.bunny = false;
  if (state.film && state.film.view) {
    const clip = state.film.clips[state.film.selected];
    if (clip) clip.sceneLora = scene;
    persistFilm();
    renderFilmClips();
  }
  syncSceneLoraChips();
  if (typeof renderInspector === "function") renderInspector();
}

function armFilmSceneLora(clip) {
  const scene = sceneLoraId(clip && (clip.sceneLora || clip.scene_lora));
  if (!scene) return "";
  state.nsfw = true;
  const chip = $("#nsfwChip");
  if (chip) chip.classList.add("on");
  SCENE_LORA_IDS.forEach((k) => { state.nsfwOn[k] = k === scene; });
  state.nsfwOn.bunny = false;
  if (clip) clip.sceneLora = scene;
  return scene;
}

function syncSceneLoraChips() {
  const host = $("#sceneLoraChips");
  if (!host) return;
  const p = state.pack;
  const show = !!(state.nsfw && p && p.family === "h3");
  host.hidden = !show;
  host.classList.toggle("show", show);
  const scene = activeSceneLora();
  host.querySelectorAll("[data-scene]").forEach((btn) => {
    const id = btn.dataset.scene;
    const rec = ((p && p.nsfw_loras) || []).find((l) => l.id === id);
    btn.classList.toggle("on", scene === id);
    btn.disabled = !!(rec && rec.missing);
  });
}

function loraChain(opts) {
  opts = opts || {};
  const scene = sceneLoraId(opts.scene);
  const out = [];
  const p = state.pack;
  const modelOnly = p.family === "h3" || p.family === "ltx";
  const idea = ($("#idea") && $("#idea").value) || "";
  (p.recommended_loras || []).forEach((l) => {
    if (l.name && state.recOn[l.id]) out.push({ name: l.name, strength: l.strength, model_only: modelOnly });
  });
  // Scene LoRA follows the clip dropdown even if the global NSFW chip is off.
  if (state.nsfw || scene) {
    (p.nsfw_loras || []).forEach((l) => {
      if (!l.name) return;
      if (SCENE_LORA_IDS.indexOf(l.id) >= 0) {
        if (l.id === scene) out.push({ name: l.name, strength: l.strength, model_only: modelOnly });
        return;
      }
      if (l.id === "bunny" && scene) return;
      if (!state.nsfw || !state.nsfwOn[l.id]) return;
      if (l.need === "explicit" && !promptLooksExplicit(idea)) return;
      out.push({ name: l.name, strength: l.strength, model_only: modelOnly });
    });
  }
  state.extraLoras.forEach((l) => {
    if (l.name) out.push({ name: l.name, strength: l.strength || 1, model_only: modelOnly });
  });
  return out;
}

function persistRun() {
  try {
    sessionStorage.setItem("yi-run", JSON.stringify({
      promptId: state.promptId,
      currentPrompt: state.currentPrompt,
      pack: state.pack && state.pack.id,
      jobPackId: state.jobPackId,
      jobPackTitle: state.jobPackTitle,
      jobFamily: state.jobFamily,
      jobStartedAt: state.jobStartedAt || 0,
      running: !!state.running,
      queue: state.queue || [],
      lastPct: state.lastPct || 0,
      currentJobKey: state.currentJobKey || null,
      filmRun: state.film && state.film.runAll ? {
        runAll: true,
        runIndex: state.film.runIndex,
      } : null,
    }));
  } catch (e) {}
}

function persistFeed() {
  try {
    sessionStorage.setItem("yi-feed", JSON.stringify({
      shown: state.shown,
      history: (state.history || []).slice(0, 24),
    }));
  } catch (e) {}
}

function restoreFeed() {
  try {
    const feed = JSON.parse(sessionStorage.getItem("yi-feed") || "null");
    if (!feed) return;
    if (Array.isArray(feed.history) && feed.history.length) state.history = feed.history;
    state.savedShown = feed.shown || null;
  } catch (e) {}
}

function showHomeStage() {
  state.shown = null;
  hideLivePreview();
  clearFrameMedia();
  const ph = $("#placeholder");
  if (ph) ph.style.display = "";
  syncVeil();
  renderStageActions();
  if (typeof syncStageNav === "function") syncStageNav();
}

function ourQueueItem(item) {
  if (!item || !item.length) return false;
  const pid = item[1];
  const extra = item[3] || {};
  if (state.promptId && pid === state.promptId) return true;
  return extra.client_id === state.clientId;
}

function findOurQueue(q) {
  const running = ((q && q.queue_running) || []).find(ourQueueItem);
  const pending = ((q && q.queue_pending) || []).filter(ourQueueItem);
  return {
    running: running ? running[1] : null,
    pending: pending.map((x) => x[1]),
  };
}

function comfyQueueBusy(q) {
  return !!(((q && q.queue_running) || []).length || ((q && q.queue_pending) || []).length);
}

function watchPrompt(pid) {
  if (watchPrompt._t) clearInterval(watchPrompt._t);
  watchPrompt._miss = 0;
  watchPrompt._t = setInterval(async () => {
    if (!state.running || state.promptId !== pid) {
      clearInterval(watchPrompt._t);
      watchPrompt._t = null;
      return;
    }
    try {
      const q = await apiFetch("/api/queue");
      const ours = findOurQueue(q);
      if (ours.running === pid || (ours.pending || []).includes(pid)) {
        watchPrompt._miss = 0;
        if (state.running && (!state.ws || state.ws.readyState > 1)) openSocket();
        return;
      }
      const h = await apiFetch("/api/history/" + pid);
      const entry = h && (h[pid] || (h.history && h.history[pid]));
      if (entry) {
        clearInterval(watchPrompt._t);
        watchPrompt._t = null;
        await onFinished(pid);
        return;
      }
      const idle = !((q.queue_running || []).length) && !((q.queue_pending || []).length);
      watchPrompt._miss = (watchPrompt._miss || 0) + 1;
      if (idle && watchPrompt._miss >= 3) {
        clearInterval(watchPrompt._t);
        watchPrompt._t = null;
        await onFinished(pid);
      }
    } catch (e) {}
  }, 1500);
}

async function resumeRun() {
  let run = null;
  try { run = JSON.parse(sessionStorage.getItem("yi-run") || "null"); } catch (e) {}
  if (run && run.currentPrompt) state.currentPrompt = run.currentPrompt;
  if (run && run.promptId && !state.promptId) state.promptId = run.promptId;
  if (run && Number(run.lastPct) > 0) state.lastPct = Number(run.lastPct);
  if (run && run.currentJobKey) state.currentJobKey = run.currentJobKey;
  if (run && run.jobPackId) state.jobPackId = run.jobPackId;
  if (run && run.jobPackTitle) state.jobPackTitle = run.jobPackTitle;
  if (run && run.jobFamily) state.jobFamily = run.jobFamily;
  if (run && Number(run.jobStartedAt) > 0) state.jobStartedAt = Number(run.jobStartedAt);
  if (run && run.filmRun && state.film) {
    state.film.runAll = !!run.filmRun.runAll;
    state.film.runIndex = Number(run.filmRun.runIndex);
  }
  renderHistory();
  if (!state.online) {
    state.resumeChecked = true;
    showHomeStage();
    return;
  }
  try {
    const q = await apiFetch("/api/queue");
    const ours = findOurQueue(q);
    if (ours.running) {
      if (run && Array.isArray(run.queue) && run.queue.length && !(state.queue || []).length) {
        state.queue = run.queue;
      }
      state.promptId = ours.running;
      const ph = ensureRunningPlaceholder();
      if (ph) showInCanvas(ph);
      else if (state.savedShown) showInCanvas(state.savedShown);
      else showHomeStage();
      startRun({ resume: true });
      persistRun();
      watchPrompt(state.promptId);
      toast("Reconnected to the job still running in ComfyUI.");
      state.resumeChecked = true;
      return;
    }
    if (state.running || state.submitting || state.promptId || (state.queue || []).length) {
      state.resumeChecked = true;
      if (comfyQueueBusy(q) && !state.running) showHomeStage();
      return;
    }
    if (comfyQueueBusy(q)) {
      state.resumeChecked = true;
      if (!state.running) showHomeStage();
      return;
    }
    discardIdlePlaceholders();
    if (run && run.promptId) {
      try { await onFinished(run.promptId, { keepHome: true, quick: true, skipKick: true }); } catch (e2) {}
    }
  } catch (e) {}
  state.resumeChecked = true;
  if (!state.running) showHomeStage();
}

function bindAssetClicks(root) {
  if (!root) return;
  root.querySelectorAll("[data-dl]").forEach((b) => {
    b.onclick = () => startDownload(b.dataset.pack, b.dataset.dl);
  });
  root.querySelectorAll("[data-cancel]").forEach((b) => {
    b.onclick = () => cancelDownload(b.dataset.cancel);
  });
}

function renderJobs(el) {
  if (!el) return;
  const jobs = (state.jobs || []).filter((j) => j.status === "queued" || j.status === "running" || j.status === "cancelling");
  if (!jobs.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = jobs.map((job) => {
    const pct = job.total ? Math.min(100, Math.round(100 * job.bytes / job.total)) : 0;
    return `<div class="asset">
      <div>
        <div class="nm">${esc(job.label || job.filename)}</div>
        <div class="fn">${fmtBytes(job.bytes)}${job.total ? " / " + fmtBytes(job.total) : ""} · ${esc(job.status)}</div>
      </div>
      <button type="button" class="ghost" data-cancel="${esc(job.id)}">Cancel</button>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join("");
  bindAssetClicks(el);
}

function renderInspector() {
  const p = state.pack;
  const body = $("#inspBody");
  if (!p) {
    if (body) body.innerHTML = "<p class='b'>Pick a model card first.</p>";
    return;
  }
  if (!body) return;
  const slots = ["unet", "clip", "vae"].concat((p.candidates && p.candidates.audio_vae) ? ["audio_vae"] : []);
  const cand = p.candidates || {};
  let html = `<p style="color:var(--dim);font-size:12.5px;margin:0 0 12px">${esc(p.blurb)}</p>`;
  html += `<button class="ghost" id="changeModel" style="width:100%;margin-bottom:12px">Change model</button>`;
  html += `<div class="sec">Required</div>`;
  slots.forEach((slot) => {
    const opts = (cand[slot] || []).slice();
    const cur = resolved()[slot] || "";
    if (cur && !opts.includes(cur)) opts.unshift(cur);
    html += `<div class="field"><label>${slot}</label>`;
    if (opts.length) {
      html += `<select data-slot="${slot}">${opts.map((n) => `<option${n === cur ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    } else {
      const miss = (p.missing || []).find((m) => m.slot === slot);
      html += `<div style="color:var(--accent);font-size:12px">Missing — put a match in <code>${esc((miss && miss.folder) || slot)}</code></div>`;
    }
    html += `</div>`;
  });

  html += `<div class="sec">Recommended LoRAs</div>`;
  if (!(p.recommended_loras || []).length) html += `<div style="color:var(--faint);font-size:12px">None for this pack.</div>`;
  (p.recommended_loras || []).forEach((l) => {
    const on = !!state.recOn[l.id];
    html += `<label class="rec"><input type="checkbox" data-rec="${l.id}" ${on ? "checked" : ""} ${l.missing ? "disabled" : ""}/>
      <span class="nm">${esc(l.label)}${l.missing ? " (not installed)" : ""}</span>
      <input class="num" data-rec-str="${l.id}" type="number" step="0.05" value="${l.strength}" style="width:64px" /></label>`;
  });

  html += `<div class="sec">NSFW LoRAs (when NSFW is on)</div>`;
  if (!(p.nsfw_loras || []).length) {
    html += `<div style="color:var(--faint);font-size:12px">No matching adult LoRAs for this pack. Prompt-only.</div>`;
  }
  (p.nsfw_loras || []).forEach((l) => {
    const on = !!state.nsfwOn[l.id];
    html += `<label class="rec"><input type="checkbox" data-nsfw="${l.id}" ${on ? "checked" : ""} ${l.missing ? "disabled" : ""}/>
      <span class="nm">${esc(l.label)}${l.missing ? " (not installed)" : ""}</span>
      <input class="num" data-nsfw-str="${l.id}" type="number" step="0.05" value="${l.strength}" style="width:64px" /></label>`;
  });

  html += `<div class="sec">Extra LoRA stack</div><div id="extraStack"></div>
    <button class="add" id="addLora">+ Add LoRA</button>`;

  html += `<div class="sec">Hugging Face files</div>
    <p class="sub" style="margin:0 0 8px">Missing weights download into <code>ComfyUI\\models</code>. When a job finishes, this panel and the dropdowns refresh.</p>`;
  (p.assets || []).forEach((a) => {
    const miss = !a.installed;
    const rec = a.kind === "recommended" ? `<span class="badge def">recommended</span>` : "";
    const job = jobFor(p.id, a.id);
    const st = job ? job.status : (miss ? "missing" : "installed");
    html += `<div class="asset">
      <div>
        <div class="nm">${esc(a.label)} ${rec}</div>
        <div class="fn">${esc(a.filename)} → ${esc(a.folder)}</div>
        ${a.note ? `<div class="fn">${esc(a.note)}</div>` : ""}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <span class="st ${st}">${st}</span>
        ${job ? `<button class="ghost" data-cancel="${job.id}">Cancel</button>` : ""}
        ${miss && !job && (a.url || a.has_url) ? `<button class="ghost" data-dl="${a.id}" data-pack="${p.id}">Download</button>` : ""}
        ${a.url ? `<a class="ghost" href="${esc(a.url)}" target="_blank" rel="noopener">Open</a>` : ""}
      </div>
      ${job ? `<div class="bar"><i style="width:${job.total ? Math.min(100, Math.round(100 * job.bytes / job.total)) : 0}%"></i></div>` : ""}
    </div>`;
  });
  html += `<div class="jobs" id="inspJobs"></div>
    <button class="ghost" id="rescanPack" style="width:100%;margin-top:10px">Rescan models</button>
    <button class="ghost" id="savePack" style="width:100%;margin-top:8px">Save as my pack</button>`;
  body.innerHTML = html;
  bindAssetClicks(body);
  renderJobs($("#inspJobs"));

  body.querySelectorAll("select[data-slot]").forEach((sel) => {
    sel.onchange = () => {
      state.overrides[sel.dataset.slot] = sel.value;
      if (sel.dataset.slot === "unet" && p.graph === "flux2_klein") {
        const n = (sel.value || "").toLowerCase();
        if (n.includes("base")) {
          $("#steps").value = 20;
          $("#cfg").value = 4;
        } else {
          $("#steps").value = 4;
          $("#cfg").value = 1;
        }
      }
    };
  });
  body.querySelectorAll("[data-rec]").forEach((cb) => {
    cb.onchange = () => {
      state.recOn[cb.dataset.rec] = cb.checked;
      if (p.graph === "qwen_edit" && cb.dataset.rec === "lightning4") {
        if (cb.checked) {
          $("#steps").value = 8;
          $("#cfg").value = 1;
          toast("Lightning on — 8 steps / CFG 1 (faster, softer anatomy).");
        } else {
          $("#steps").value = 20;
          $("#cfg").value = 2.2;
          toast("Lightning off — 20 steps / CFG 2.2.");
        }
      }
    };
  });
  body.querySelectorAll("[data-rec-str]").forEach((inp) => {
    inp.oninput = () => {
      const rec = (p.recommended_loras || []).find((x) => x.id === inp.dataset.recStr);
      if (rec) rec.strength = parseFloat(inp.value) || 1;
    };
  });
  body.querySelectorAll("[data-nsfw]").forEach((cb) => {
    cb.onchange = () => {
      const id = cb.dataset.nsfw;
      if (SCENE_LORA_IDS.indexOf(id) >= 0) {
        setSceneLora(cb.checked ? id : "");
        return;
      }
      state.nsfwOn[id] = cb.checked;
      if (id === "aftermidnight") syncAfterMidnightScheduler();
    };
  });
  body.querySelectorAll("[data-nsfw-str]").forEach((inp) => {
    inp.oninput = () => {
      const rec = (p.nsfw_loras || []).find((x) => x.id === inp.dataset.nsfwStr);
      if (rec) rec.strength = parseFloat(inp.value) || 1;
    };
  });
  const add = body.querySelector("#addLora");
  if (add) {
    add.onclick = () => {
      state.extraLoras.push({ name: "", strength: 1 });
      renderExtra();
    };
  }
  const save = body.querySelector("#savePack");
  if (save) save.onclick = saveCustom;
  const cm = body.querySelector("#changeModel");
  if (cm) cm.onclick = () => {
    closeInspector();
    openSheet({ returnTo: "inspector" });
  };
  const rescan = body.querySelector("#rescanPack");
  if (rescan) rescan.onclick = () => scan({ quiet: true, skipSetup: true });
  renderExtra();
}

function renderExtra() {
  const box = $("#extraStack");
  if (!box) return;
  box.innerHTML = "";
  state.extraLoras.forEach((row, i) => {
    const wrap = document.createElement("div");
    wrap.className = "lora-row";
    const sel = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "pick a matching LoRA…";
    sel.appendChild(blank);
    state.loras.forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    });
    sel.value = row.name || "";
    sel.onchange = () => (row.name = sel.value);
    const st = document.createElement("input");
    st.className = "num";
    st.type = "number";
    st.step = "0.05";
    st.value = row.strength;
    st.oninput = () => (row.strength = parseFloat(st.value) || 1);
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "×";
    del.onclick = () => {
      state.extraLoras.splice(i, 1);
      renderExtra();
    };
    wrap.append(sel, st, del);
    box.appendChild(wrap);
  });
}

async function saveCustom() {
  const p = state.pack;
  if (!p) return;
  const files = {};
  Object.entries(resolved()).forEach(([k, v]) => {
    files[k] = [v];
  });
  const rec = (p.recommended_loras || [])
    .filter((l) => state.recOn[l.id] && l.name)
    .concat(state.extraLoras.filter((l) => l.name).map((l, i) => ({ id: "extra" + i, label: l.name, patterns: [l.name], strength: l.strength, on: true })));
  const id = (p.id + "-mine").replace(/[^a-z0-9\-]+/g, "-");
  await apiFetch("/api/packs/save", {
    method: "POST",
    body: JSON.stringify({
      id,
      title: p.title + " (mine)",
      blurb: p.blurb,
      modes: p.modes,
      family: p.family,
      clip_type: p.clip_type,
      graph: p.graph,
      prompt_recipe: p.prompt_recipe,
      files,
      recommended_loras: rec,
      nsfw_loras: p.nsfw_loras || [],
      defaults: {
        steps: $("#steps").value,
        cfg: $("#cfg").value,
        sampler: $("#sampler").value,
        scheduler: $("#scheduler").value,
      },
    }),
  });
  toast("Saved as " + id);
  scan();
}

function setUiMode(mode, opts) {
  opts = opts || {};
  mode = normalizeUiMode(mode);
  state.uiMode = mode;
  const seg = $("#modeSeg");
  if (seg) [...seg.children].forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  syncAttach();
  const dur = $("#dur");
  if (dur) dur.classList.toggle("show", mode === "video");
  if (typeof syncRefStrip === "function") syncRefStrip();
  if (!opts.keepPack) {
    if (mode === "ref_image" && state.pack) {
      if (!opts.silent && r2iPackIsWeak(state.pack)) warnWeakR2I(state.pack);
    } else {
      ensurePackForUiMode(mode);
    }
  } else if (mode !== "ref_image" && state.pack && !packSupports(state.pack, mode)) {
    ensurePackForUiMode(mode);
  }
  applyModeSettings();
  syncMpControls();
  closePackMenu();
  renderPackMenu();
}

async function rewritePrompt() {
  const idea = $("#idea").value.trim();
  if (!idea) {
    toast("Type what you want first.", true);
    return;
  }
  if (!state.pack) {
    toast("Pick a model first.", true);
    return;
  }
  try {
    const filmOn = !!(state.film && state.film.view);
    const h3 = state.pack.family === "h3";
    const path = h3 ? (filmOn ? "" : composerH3Path()) : "";
    const r2v = path === "r2v";
    const refs = r2v ? (filmOn ? filmRefs() : composerRefNames()) : [];
    const tags = r2v ? (filmOn ? filmCharTags() : composerCharTags()) : [];
    const flags = r2v ? (filmOn ? filmSceneFlags() : composerSceneFlags()) : [];
    const videoOn = state.uiMode === "video" || filmOn;
    const clip = filmOn && state.film && state.film.clips[state.film.selected];
    const text = await window.ImagineRecipes.rewrite(idea, {
      recipe: state.pack.prompt_recipe,
      pack: state.pack.family || state.pack.prompt_recipe,
      mode: genMode(),
      has_image: attachOn() && !!state.initName && !r2v,
      nsfw: state.nsfw,
      h3_path: path,
      ref_count: refs.length,
      character_tags: tags,
      scene_flags: flags,
      duration: videoOn
        ? (clip ? (clip.duration || state.film.duration || 8) : readDuration())
        : 0,
      want_audio: videoOn && packWantsAudio(),
      film: filmOn,
      scene_lora: activeSceneLora({ film_clip: clip && clip.id }),
      dialogue: clip ? (clip.dialogue || "") : "",
      soundscape: clip ? (clip.soundscape || "") : "",
      model: selectedRewriter(),
    });
    $("#idea").value = text;
    if (clip) {
      applyH3AudioToClip(clip, text);
      persistFilm();
      renderFilmClips();
    }
    const err = window.ImagineRecipes && window.ImagineRecipes.lastError;
    if (err) toast(err, true);
    else toast(window.ImagineRecipes && window.ImagineRecipes.lastSource === "llm"
      ? "Rewritten with local model."
      : "Structured for this mode.");
  } catch (e) {
    toast("Rewrite failed: " + e.message, true);
  }
}

function emptyFilmClip() {
  return {
    id: "c" + Math.random().toString(36).slice(2, 8),
    prompt: "",
    dialogue: "",
    soundscape: "",
    firstName: null,
    firstUrl: null,
    lastName: null,
    result: null,
    status: "idle",
    duration: (state.film && state.film.duration) || 8,
    sceneLora: "",
  };
}

function emptyCharSlot(label, role) {
  return {
    id: "p" + Math.random().toString(36).slice(2, 8),
    name: "",
    url: "",
    label: label || "",
    role: role === "scene" ? "scene" : "identity",
  };
}
function emptyFilmChar(label) {
  return emptyCharSlot(label);
}

function defaultFilm() {
  return {
    view: false,
    bible: "",
    continue: true,
    duration: 8,
    characters: [emptyFilmChar(), emptyFilmChar()],
    clips: [emptyFilmClip(), emptyFilmClip()],
    selected: 0,
    runAll: false,
    runIndex: -1,
    title: "",
  };
}

function migrateFilmChars(saved) {
  if (Array.isArray(saved.characters) && saved.characters.length) {
    return saved.characters.map((c) => Object.assign(emptyFilmChar(), c, {
      label: (c && c.label) || "",
      role: (c && c.role) === "scene" ? "scene" : "identity",
    }));
  }
  const out = [];
  if (saved.refA) out.push(Object.assign(emptyFilmChar(), saved.refA, { label: (saved.refA.label || "") }));
  if (saved.refB) out.push(Object.assign(emptyFilmChar(), saved.refB, { label: (saved.refB.label || "") }));
  if (!out.length) return [emptyFilmChar(), emptyFilmChar()];
  return out;
}

function charViewUrl(name) {
  if (!name) return "";
  return viewUrl({ filename: name, subfolder: "", type: "input" });
}

function loadFilm() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("yi-film") || "null"); } catch (e) {}
  const base = defaultFilm();
  if (!saved || typeof saved !== "object") return base;
  base.bible = saved.bible || "";
  base.continue = saved.continue !== false;
  base.duration = Number(saved.duration) || 8;
  base.title = saved.title || "";
  base.characters = migrateFilmChars(saved);
  base.characters.forEach((c) => {
    if (c.name && !c.url) c.url = charViewUrl(c.name);
  });
  if (Array.isArray(saved.clips) && saved.clips.length) {
    base.clips = saved.clips.map((c) => hydrateFilmClip(c, base.duration));
  }
  return base;
}

function asClipResult(raw) {
  if (!raw) return null;
  const r = typeof raw === "string"
    ? { filename: raw, subfolder: "", type: "output" }
    : Object.assign({}, raw);
  if (!r.filename) return null;
  r.subfolder = r.subfolder || "";
  r.type = r.type || "output";
  r.kind = r.kind || (isVideoFile(r.filename) ? "video" : "image");
  r.url = r.url || viewUrl(r);
  return r;
}

function hydrateFilmClip(c, duration) {
  const clip = Object.assign(emptyFilmClip(), c, {
    status: c.status === "running" ? "idle" : (c.status || "idle"),
    duration: Number(c.duration) || duration || 8,
    dialogue: c.dialogue || "",
    soundscape: c.soundscape || "",
    sceneLora: sceneLoraId(c.sceneLora || c.scene_lora),
  });
  if (clip.firstName && !clip.firstUrl) clip.firstUrl = charViewUrl(clip.firstName);
  clip.result = asClipResult(clip.result);
  peelShotIntoClip(clip);
  return clip;
}

function ensureFilm() {
  if (!state.film) state.film = loadFilm();
  return state.film;
}

function persistFilm() {
  if (!state.film) return;
  try {
    localStorage.setItem("yi-film", JSON.stringify({
      format: "yi-film-snap",
      title: state.film.title || "",
      bible: state.film.bible,
      continue: state.film.continue,
      duration: state.film.duration,
      characters: (state.film.characters || []).map((c) => ({
        id: c.id, name: c.name || "", label: c.label || "",
        role: c.role === "scene" ? "scene" : "identity",
      })),
      clips: state.film.clips.map((c) => ({
        id: c.id,
        prompt: c.prompt,
        dialogue: c.dialogue || "",
        soundscape: c.soundscape || "",
        firstName: c.firstName,
        lastName: c.lastName,
        result: c.result,
        status: c.status === "running" ? "idle" : c.status,
        duration: c.duration || state.film.duration || 8,
        sceneLora: sceneLoraId(c.sceneLora),
        scene_lora: sceneLoraId(c.sceneLora),
      })),
    }));
  } catch (e) {}
}

function filmRefs() {
  const f = state.film || defaultFilm();
  return (f.characters || []).map((c) => c && c.name).filter(Boolean);
}

function filmCharTags() {
  const f = state.film || defaultFilm();
  return (f.characters || []).filter((c) => c && c.name).map((c) => String(c.label || "").trim());
}
function filmSceneFlags() {
  const f = state.film || defaultFilm();
  return (f.characters || []).filter((c) => c && c.name).map((c) => c.role === "scene");
}
function filledSlots(slots) {
  return (slots || []).filter((c) => c && c.name);
}
function loadComposerRefs() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("yi-refs") || "null"); } catch (e) {}
  const slots = (saved && Array.isArray(saved.slots) && saved.slots.length)
    ? saved.slots.map((c) => Object.assign(emptyCharSlot(), c, {
        label: (c && c.label) || "",
        role: (c && c.role) === "scene" ? "scene" : "identity",
      }))
    : [emptyCharSlot()];
  slots.forEach((c) => {
    if (c.name && !c.url) c.url = charViewUrl(c.name);
  });
  return slots.slice(0, REF_SLOT_MAX);
}
function ensureComposerRefs() {
  if (!state.refs || !state.refs.length) state.refs = loadComposerRefs();
  return state.refs;
}
function persistComposerRefs() {
  try {
    localStorage.setItem("yi-refs", JSON.stringify({
      slots: ensureComposerRefs().map((c) => ({
        id: c.id, name: c.name || "", label: c.label || "",
        role: c.role === "scene" ? "scene" : "identity",
      })),
    }));
  } catch (e) {}
}
function composerRefNames() {
  return filledSlots(ensureComposerRefs()).map((c) => c.name);
}
function composerCharTags() {
  return filledSlots(ensureComposerRefs()).map((c) => String(c.label || "").trim());
}
function composerSceneFlags() {
  return filledSlots(ensureComposerRefs()).map((c) => c.role === "scene");
}
function composerH3Path() {
  if (!state.pack || state.pack.family !== "h3") return "";
  if (state.uiMode === "ref_image") return "r2v";
  if (state.uiMode === "video") {
    if (cowgirlFilePicked() && hasRef2va() && (state.initName || composerRefNames().length)) return "r2v";
    if (state.initName) return "i2v";
    if (composerRefNames().length && hasRef2va()) return "r2v";
    return "t2v";
  }
  return "";
}
function refsStripOn() {
  return (state.uiMode === "ref_image" || state.uiMode === "video") && !(state.film && state.film.view);
}
function syncRefStrip() {
  document.body.classList.toggle("refs-on", refsStripOn());
  if (refsStripOn()) renderComposerRefs();
}

function loadCharLib() {
  try {
    const list = JSON.parse(localStorage.getItem("yi-char-lib") || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function persistCharLib(list) {
  try { localStorage.setItem("yi-char-lib", JSON.stringify(list.slice(0, 80))); } catch (e) {}
}

function rememberCharacter(rec) {
  if (!rec || !rec.name) return;
  const list = loadCharLib();
  const hit = list.findIndex((x) => x.name === rec.name);
  const row = {
    id: rec.id || (hit >= 0 ? list[hit].id : ("ch" + Date.now())),
    name: rec.name,
    label: rec.label || (hit >= 0 ? list[hit].label : "") || "Character",
    ts: Date.now(),
  };
  if (hit >= 0) list[hit] = Object.assign({}, list[hit], row);
  else list.unshift(row);
  persistCharLib(list);
}

function loadFilmWips() {
  try {
    const list = JSON.parse(localStorage.getItem("yi-film-wips") || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function persistFilmWips(list) {
  try { localStorage.setItem("yi-film-wips", JSON.stringify(list.slice(0, 24))); } catch (e) {}
}

function filmSnapshot() {
  persistFilm();
  try { return JSON.parse(localStorage.getItem("yi-film") || "{}"); } catch (e) { return {}; }
}

function applyFilmSnapshot(snap) {
  try { localStorage.setItem("yi-film", JSON.stringify(snap || {})); } catch (e) {}
  const loaded = loadFilm();
  loaded.view = !!(state.film && state.film.view);
  state.film = loaded;
  persistFilm();
  renderFilm();
}

function saveFilmWip() {
  ensureFilm();
  const suggested = state.film.title || "Untitled story";
  const title = window.prompt("Name this story", suggested);
  if (title == null) return;
  const name = String(title).trim() || suggested;
  state.film.title = name;
  const snap = filmSnapshot();
  snap.title = name;
  const list = loadFilmWips();
  list.unshift({ id: "w" + Date.now(), title: name, ts: Date.now(), snap });
  persistFilmWips(list);
  persistFilm();
  renderFilmWips();
  apiFetch("/api/film/stories", { method: "POST", body: JSON.stringify({ title: name, snap }) })
    .then(() => { refreshDiskStories(); toast("Saved “" + name + "” on this browser and on disk."); })
    .catch(() => toast("Saved “" + name + "” in this browser. Export to keep a file copy."));
}

async function loadPickedWip() {
  const sel = $("#filmWipPick");
  const id = sel && sel.value;
  if (!id) {
    toast("Pick a saved story first.", true);
    return;
  }
  if (id.indexOf("disk:") === 0) {
    try {
      const j = await apiFetch("/api/film/stories/" + encodeURIComponent(id.slice(5)));
      const snap = await resolveFilmImport(j.snap || j);
      applyFilmSnapshot(snap);
      toast("Loaded “" + (snap.title || "story") + "”.");
    } catch (e) {
      toast("Could not load that disk story: " + (e && e.message ? e.message : e), true);
    }
    return;
  }
  const row = loadFilmWips().find((w) => w.id === id);
  if (!row || !row.snap) {
    toast("That save is gone.", true);
    return;
  }
  applyFilmSnapshot(row.snap);
  toast("Loaded “" + (row.title || "story") + "”.");
}

function notesWipToSnap(obj) {
  const vids = obj.videos || {};
  const gate = obj.gate || {};
  const keys = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const hasKeys = keys.some((k) => Object.prototype.hasOwnProperty.call(vids, k));
  const ids = hasKeys ? keys : (Object.keys(vids).length ? Object.keys(vids) : keys);
  const stillMap = {
    c1: (gate.c1_still && gate.c1_still.input) || null,
    c2: (gate.c2_still_v2 && gate.c2_still_v2.input) || null,
    c5: (gate.c5_still && gate.c5_still.input) || null,
  };
  const lastMap = {
    c2: (gate.c2_video && gate.c2_video.last) || null,
    c5: (gate.c5_video && gate.c5_video.last) || null,
  };
  return {
    format: "yi-film-snap",
    title: obj.title || obj.wip_name || "Imported story",
    bible: obj.bible || "",
    continue: true,
    duration: Number(obj.duration) || 10,
    characters: Array.isArray(obj.characters) && obj.characters.length
      ? obj.characters
      : [emptyFilmChar(), emptyFilmChar()],
    clips: ids.map((id) => {
      const gateVid = gate[id + "_video"];
      const filename = vids[id] || (gateVid && gateVid.file) || null;
      const clip = emptyFilmClip();
      clip.id = id;
      clip.duration = Number(obj.duration) || 10;
      if (stillMap[id]) clip.firstName = stillMap[id];
      if (lastMap[id]) clip.lastName = lastMap[id];
      if (filename) {
        clip.result = asClipResult({ filename, subfolder: "", type: "output", kind: "video" });
        clip.status = "done";
      }
      return clip;
    }),
  };
}

function normalizeFilmImport(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Not a story file");
  if (obj.format === "yi-film-snap" && Array.isArray(obj.clips)) return obj;
  if (obj.snap && typeof obj.snap === "object" && Array.isArray(obj.snap.clips)) return obj.snap;
  if (Array.isArray(obj.clips)) return obj;
  if (obj.videos || obj.wip_name || obj.gate) return notesWipToSnap(obj);
  throw new Error("Not a Film story");
}

async function resolveFilmImport(obj) {
  if (obj && typeof obj.snap === "string" && !Array.isArray(obj.clips) && (obj.videos || obj.gate || obj.wip_name)) {
    const slug = obj.snap.replace(/\\/g, "/").split("/").pop().replace(/\.json$/i, "");
    if (slug) {
      try {
        const j = await apiFetch("/api/film/stories/" + encodeURIComponent(slug));
        const inner = j && (j.snap || j);
        if (inner && Array.isArray(inner.clips)) return normalizeFilmImport(inner);
      } catch (e) {}
    }
  }
  return normalizeFilmImport(obj);
}

function filmExportFilename(title) {
  const s = String(title || "story").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "story";
  return s.toLowerCase() + "-film.json";
}

async function exportFilmSnap() {
  ensureFilm();
  const snap = filmSnapshot();
  snap.format = "yi-film-snap";
  if (state.film.title) snap.title = state.film.title;
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filmExportFilename(snap.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  try {
    await apiFetch("/api/film/stories", { method: "POST", body: JSON.stringify({ title: snap.title, snap }) });
    refreshDiskStories();
    toast("Exported and saved on disk.");
  } catch (e) {
    toast("Downloaded “" + (snap.title || "story") + "”. Import that file in any browser.");
  }
}

async function importFilmFile(file) {
  const text = await file.text();
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error("That file is not JSON."); }
  const snap = await resolveFilmImport(obj);
  applyFilmSnapshot(snap);
  if (snap.title) {
    const list = loadFilmWips();
    list.unshift({ id: "w" + Date.now(), title: snap.title, ts: Date.now(), snap });
    persistFilmWips(list);
    renderFilmWips();
  }
  toast("Imported “" + (snap.title || "story") + "”.");
}

function pickFilmImport() {
  const inp = $("#filmImportFile");
  if (inp) inp.click();
}

async function refreshDiskStories() {
  try {
    const j = await apiFetch("/api/film/stories");
    state.diskStories = (j && j.stories) || [];
  } catch (e) {
    state.diskStories = [];
  }
  renderFilmWips();
}

function resetFilmBoard() {
  if (!window.confirm("Clear the whole storyboard? Saved stories stay in the list.")) return;
  const view = !!(state.film && state.film.view);
  state.film = defaultFilm();
  state.film.view = view;
  persistFilm();
  renderFilm();
  toast("Storyboard cleared.");
}

function clipHasVideo(clip) {
  const r = clip && asClipResult(clip.result);
  if (r) clip.result = r;
  return !!(r && r.filename && (r.kind === "video" || isVideoFile(r.filename)));
}

function syncFilmGenAllLabel() {
  const all = $("#filmGenAll");
  if (!all) return;
  const clips = (state.film && state.film.clips) || [];
  all.textContent = clips.some(clipHasVideo) ? "Generate remaining" : "Generate";
}

function clipNeedsVideo(clip) {
  if (!clip || clipHasVideo(clip)) return false;
  return !!(String(clip.prompt || "").trim() || clip.firstName);
}

function nextFilmNeedIndex(from) {
  from = Math.max(0, Number(from) || 0);
  const clips = (state.film && state.film.clips) || [];
  const need = (c, i) => i >= from && clipNeedsVideo(c);
  const sel = state.film ? Number(state.film.selected) : -1;
  if (sel >= from && clipNeedsVideo(clips[sel]) && (clips[sel].firstName || state.initName)) return sel;
  const withStill = clips.findIndex((c, i) => need(c, i) && c.firstName);
  if (withStill >= 0) return withStill;
  if (sel >= from && clipNeedsVideo(clips[sel])) return sel;
  return clips.findIndex((c, i) => need(c, i));
}

function adoptComposerStill(clip, index) {
  if (!clip || clip.firstName || !state.initName) return false;
  const remaining = ((state.film && state.film.clips) || []).filter(clipNeedsVideo);
  const selected = !!(state.film && state.film.selected === index);
  if (!selected && remaining.length > 1) return false;
  clip.firstName = state.initName;
  clip.firstUrl = state.initUrl || charViewUrl(state.initName);
  return true;
}

function primeVideoThumb(el) {
  if (!el) return;
  el.muted = true;
  el.playsInline = true;
  if (!el.getAttribute("preload")) el.preload = "metadata";
  const paint = () => {
    try {
      if (el.readyState >= 1 && el.currentTime < 0.05) el.currentTime = 0.08;
    } catch (e) {}
  };
  el.addEventListener("loadedmetadata", paint, { once: true });
  el.addEventListener("loadeddata", paint, { once: true });
}

function pickFilmMedia(mediaList) {
  const list = mediaList || [];
  return list.find((m) => m && isVideoFile(m.filename))
    || list.find((m) => m && m.kind === "video")
    || list[0]
    || null;
}

function hasRef2va() {
  const r = state.pack && state.pack.resolved;
  return !!(r && r.ref_unet);
}
function packWantsAudio() {
  const r = state.pack && state.pack.resolved;
  return !!(r && r.audio_vae);
}

function renderFilmHint() {
  const el = $("#filmHint");
  if (!el) return;
  const n = filmRefs().length;
  el.textContent = (
    "Start still on a clip = that shot’s first frame (I2V). Empty start still = continue from the previous last frame. "
    + "No start still + character refs = R2V, which invents pose from face crops. "
    + "For sex poses where the camera sees her groin, a posed start still holds anatomy better than R2V. "
    + "R2V keeps full-res identity refs; output stays ~0.6MP on 8GB. "
    + "Generate skips clips that already have a video. "
    + "Drop an image on Start still, or Frame from video… / drop a video there to grab a frame. "
    + "Drop an mp4 on the clip card / Use history… to put an existing take on that card. "
    + "Export/Import the story JSON so it survives other browsers. "
    + (n ? ("Character slots map to <Picture 1>…<Picture " + n + ">. Put the person facing the camera in Character 1.") : "Add character face crops for identity.")
  );
}

function filmCharHintHtml(ch, i) {
  const picN = esc("<Picture " + (i + 1) + ">");
  const tag = String((ch && ch.label) || "").trim();
  return (tag ? esc(tag) + "<br>" : "") + picN;
}

let filmTagTimer = 0;

function camelPrefix(prefix, suffix) {
  return prefix + suffix.charAt(0).toUpperCase() + suffix.slice(1);
}
function syncLibOptionLabels(name, label) {
  const text = String(label || "").trim() || name;
  document.querySelectorAll(".char-lib option").forEach((opt) => {
    if (opt.value === name) opt.textContent = text;
  });
}
function renderRefSlots(host, slots, opts) {
  opts = opts || {};
  if (!host) return;
  const lib = loadCharLib();
  const prefix = opts.prefix || "char";
  const showRole = !!opts.showRole;
  const minSlots = opts.minSlots == null ? 1 : opts.minSlots;
  const persist = opts.persist || (() => {});
  const after = opts.after || (() => {});
  const upload = opts.upload;
  const hintFn = opts.hintHtml || filmCharHintHtml;
  host.innerHTML = "";
  (slots || []).forEach((ch, i) => {
    const wrap = document.createElement("div");
    wrap.className = "film-char";
    wrap.innerHTML =
      `<div class="film-ref${ch.url || ch.name ? " filled" : ""}" data-${prefix}="${i}">` +
      `<input type="file" accept="image/*" hidden data-${prefix}-file="${i}" />` +
      `<span class="hint">${hintFn(ch, i)}</span>` +
      `<button type="button" class="x" data-${prefix}-clear="${i}">×</button>` +
      (ch.url || ch.name ? `<img alt="" src="${esc(ch.url || charViewUrl(ch.name))}">` : "") +
      `</div>` +
      `<div class="film-char-meta">` +
      `<input type="text" class="film-char-tag" data-${prefix}-tag="${i}" placeholder="Name / tag" maxlength="40" autocomplete="off" value="${esc(ch.label || "")}" />` +
      (showRole
        ? `<select data-${prefix}-role="${i}" title="Identity face or scene/pose">` +
          `<option value="identity"${ch.role !== "scene" ? " selected" : ""}>Identity</option>` +
          `<option value="scene"${ch.role === "scene" ? " selected" : ""}>Scene</option>` +
          `</select>`
        : "") +
      `<select class="char-lib" data-${prefix}-lib="${i}"><option value="">Library…</option>${lib.map((row) =>
        `<option value="${esc(row.name)}"${row.name === ch.name ? " selected" : ""}>${esc(row.label || row.name)}</option>`
      ).join("")}</select>` +
      `<button type="button" data-${prefix}-del="${i}" title="Remove slot">✕</button>` +
      `</div>`;
    host.appendChild(wrap);
  });
  host.querySelectorAll(`[data-${prefix}]`).forEach((box) => {
    box.onclick = (e) => {
      if (e.target.closest(".x") || e.target.closest("select") || e.target.closest("input")) return;
      const file = box.querySelector("input[type=file]");
      if (file) file.click();
    };
    wireDrop(box, (files) => {
      const img = files.find(isImageFile);
      const i = Number(box.getAttribute("data-" + prefix));
      if (img && upload) upload(i, img);
      else if (!img) toast("Drop an image.", true);
    });
  });
  host.querySelectorAll(`[data-${prefix}-tag]`).forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset[camelPrefix(prefix, "tag")]);
      if (!slots[i]) return;
      slots[i].label = inp.value;
      const hint = host.querySelector(`[data-${prefix}="${i}"] .hint`);
      if (hint) hint.innerHTML = hintFn(slots[i], i);
      clearTimeout(filmTagTimer);
      filmTagTimer = setTimeout(() => {
        persist();
        const rec = slots[i];
        if (rec && rec.name) {
          const list = loadCharLib();
          const hit = list.findIndex((x) => x.name === rec.name);
          if (hit >= 0) {
            list[hit].label = rec.label || "";
            persistCharLib(list);
            syncLibOptionLabels(rec.name, rec.label);
          }
        }
      }, 350);
    };
  });
  host.querySelectorAll(`[data-${prefix}-role]`).forEach((sel) => {
    sel.onchange = () => {
      const i = Number(sel.dataset[camelPrefix(prefix, "role")]);
      if (!slots[i]) return;
      slots[i].role = sel.value === "scene" ? "scene" : "identity";
      persist();
      after();
    };
  });
  host.querySelectorAll(`[data-${prefix}-file]`).forEach((inp) => {
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      const i = Number(inp.dataset[camelPrefix(prefix, "file")]);
      inp.value = "";
      if (f && upload) upload(i, f);
    };
  });
  host.querySelectorAll(`[data-${prefix}-clear]`).forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset[camelPrefix(prefix, "clear")]);
      if (!slots[i]) return;
      slots[i].name = "";
      slots[i].url = "";
      persist();
      after();
    };
  });
  host.querySelectorAll(`[data-${prefix}-del]`).forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if ((slots || []).length <= minSlots) return;
      const i = Number(btn.dataset[camelPrefix(prefix, "del")]);
      slots.splice(i, 1);
      persist();
      after();
    };
  });
  host.querySelectorAll(`[data-${prefix}-lib]`).forEach((sel) => {
    sel.onchange = () => {
      const i = Number(sel.dataset[camelPrefix(prefix, "lib")]);
      const name = sel.value;
      if (!slots[i] || !name) return;
      const row = lib.find((x) => x.name === name) || { name, label: "" };
      slots[i].name = row.name;
      slots[i].url = charViewUrl(row.name);
      if (row.label) slots[i].label = row.label;
      persist();
      after();
    };
  });
}
function renderFilmChars() {
  const host = $("#filmChars");
  if (!host || !state.film) return;
  renderRefSlots(host, state.film.characters || [], {
    prefix: "char",
    showRole: false,
    minSlots: 1,
    persist: persistFilm,
    after: () => { persistFilm(); renderFilmChars(); renderFilmHint(); },
    upload: setFilmChar,
  });
}
function renderComposerRefs() {
  const host = $("#refSlots");
  if (!host) return;
  renderRefSlots(host, ensureComposerRefs(), {
    prefix: "cref",
    showRole: true,
    minSlots: 1,
    persist: persistComposerRefs,
    after: () => { persistComposerRefs(); renderComposerRefs(); },
    upload: setComposerRef,
    hintHtml: () => "",
  });
}
async function setComposerRef(index, file) {
  try {
    const name = await uploadInit(file);
    const slots = ensureComposerRefs();
    const rec = slots[index] || emptyCharSlot();
    rec.name = name;
    rec.url = URL.createObjectURL(file);
    rec.label = rec.label || "";
    slots[index] = rec;
    rememberCharacter(rec);
    persistComposerRefs();
    renderComposerRefs();
    const tag = String(rec.label || "").trim() || (rec.role === "scene" ? "Scene" : ("Character " + (index + 1)));
    toast(tag + " saved as " + "<Picture " + (index + 1) + ">.");
  } catch (e) {
    toast("Upload failed: " + (e && e.message ? e.message : e), true);
  }
}

function renderFilmWips() {
  const sel = $("#filmWipPick");
  if (!sel) return;
  const cur = sel.value;
  const list = loadFilmWips();
  const disk = state.diskStories || [];
  const localOpts = list.map((w) =>
    `<option value="${esc(w.id)}">${esc(w.title || "Untitled")} · ${fmtAgo(w.ts) || ""}</option>`
  ).join("");
  const diskOpts = disk.map((w) =>
    `<option value="disk:${esc(w.id)}">${esc(w.title || w.id)} · disk</option>`
  ).join("");
  sel.innerHTML = `<option value="">Saved stories</option>` + localOpts + diskOpts;
  if (cur && (list.some((w) => w.id === cur) || disk.some((w) => ("disk:" + w.id) === cur))) sel.value = cur;
}

async function setFilmChar(index, file) {
  try {
    const name = await uploadInit(file);
    const rec = state.film.characters[index] || emptyFilmChar("Character " + (index + 1));
    rec.name = name;
    rec.url = URL.createObjectURL(file);
    rec.label = rec.label || "";
    state.film.characters[index] = rec;
    rememberCharacter(rec);
    persistFilm();
    renderFilmChars();
    renderFilmWips();
    const tag = String(rec.label || "").trim() || ("Character " + (index + 1));
    toast(tag + " saved as " + "<Picture " + (index + 1) + ">.");
  } catch (e) {
    toast("Upload failed: " + (e && e.message ? e.message : e), true);
  }
}

function renderFilmClips() {
  const host = $("#filmClips");
  if (!host || !state.film) return;
  host.innerHTML = "";
  state.film.clips.forEach((clip, i) => {
    const card = document.createElement("div");
    card.className = "film-clip" + (state.film.selected === i ? " on" : "") + (clip.status === "running" ? " running" : "") + (clipHasVideo(clip) ? " done" : "");
    const result = asClipResult(clip.result);
    if (result) clip.result = result;
    const mediaUrl = result && (result.url || viewUrl(result));
    const thumb = mediaUrl
      ? `<div class="film-clip-thumb show">${(result.kind === "video" || isVideoFile(result.filename)) ? `<video src="${esc(mediaUrl)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(mediaUrl)}" alt="">`}</div>`
      : "";
    const still = `<div class="film-still-drop${clip.firstUrl ? " filled" : ""}" data-film-still-drop="${i}">` +
      (clip.firstUrl ? `<img alt="" src="${esc(clip.firstUrl)}">` : "") +
      `<span class="hint">${clip.firstUrl ? "Start still — drop a video here to grab a new frame" : "Start still — drop an image, or a video to grab a frame"}</span>` +
      `</div>`;
    const st = clipHasVideo(clip) ? "done" : (clip.status || "idle");
    const scene = sceneLoraId(clip.sceneLora);
    const sceneOpts = [["", "LoRA"], ["masturbation", "Masturbation"], ["fingering", "Fingering"], ["cowgirl", "Cowgirl"]]
      .map(([v, lab]) => `<option value="${v}"${scene === v ? " selected" : ""}>${lab}</option>`).join("");
    card.innerHTML =
      `<div class="film-clip-head"><strong>Clip ${i + 1}</strong>` +
      `<label class="film-clip-dur"><input data-film-dur="${i}" type="number" min="4" max="10" value="${esc(String(clip.duration || state.film.duration || 8))}" /> sec</label>` +
      `<label class="film-clip-lora"><select data-film-scene="${i}">${sceneOpts}</select></label>` +
      `<span class="st">${esc(st)}</span></div>` +
      thumb +
      still +
      `<label class="film-field-shot">Shot — visual / camera only</label><textarea data-film-prompt="${i}" placeholder="What happens in this clip — visuals and camera only. Not speech.">${esc(clip.prompt || "")}</textarea>` +
      `<label class="film-field-dialogue">Dialogue — spoken only</label><textarea class="film-audio" data-film-dialogue="${i}" placeholder="Quoted spoken line only. Write none if silent. Not the shot.">${esc(clip.dialogue || "")}</textarea>` +
      `<label class="film-field-sound">Soundscape — sounds only</label><textarea class="film-audio" data-film-soundscape="${i}" placeholder="Diegetic sounds only: radio, fan, bed, breath. Not the shot.">${esc(clip.soundscape || "")}</textarea>` +
      `<div class="film-clip-tools">` +
      `<button type="button" class="sparklet" data-film-rewrite="${i}" title="Structure for this clip">✦</button>` +
      `<button type="button" data-film-start="${i}">Start still</button>` +
      `<button type="button" data-film-frame="${i}">Frame from video…</button>` +
      `<button type="button" data-film-ref-still="${i}">Ref still</button>` +
      `<button type="button" data-film-use-video="${i}">Use history…</button>` +
      `<button type="button" data-film-clear-still="${i}">Clear still</button>` +
      `<button type="button" data-film-clear="${i}">Clear clip</button>` +
      `<button type="button" data-film-insert-above="${i}">Insert above</button>` +
      `<button type="button" data-film-insert="${i}">Insert below</button>` +
      `<button type="button" data-film-del="${i}">Remove</button>` +
      `</div>`;
    card.onclick = (e) => {
      if (e.target.closest("button, textarea, input, select")) return;
      state.film.selected = i;
      renderFilmClips();
      syncSceneLoraChips();
    };
    wireDrop(card, (files) => handleClipDrop(i, files));
    const stillBox = card.querySelector("[data-film-still-drop]");
    if (stillBox) {
      stillBox.onclick = (e) => {
        e.stopPropagation();
        pickFilmStill(i);
      };
      wireDrop(stillBox, (files) => handleStillDrop(i, files));
    }
    host.appendChild(card);
  });
  host.querySelectorAll(".film-clip-thumb video").forEach(primeVideoThumb);
  syncFilmGenAllLabel();
  host.querySelectorAll("[data-film-prompt]").forEach((ta) => {
    ta.oninput = () => {
      const i = Number(ta.dataset.filmPrompt);
      if (state.film.clips[i]) state.film.clips[i].prompt = ta.value;
      persistFilm();
    };
  });
  host.querySelectorAll("[data-film-dialogue]").forEach((ta) => {
    ta.oninput = () => {
      const i = Number(ta.dataset.filmDialogue);
      if (state.film.clips[i]) state.film.clips[i].dialogue = ta.value;
      persistFilm();
    };
  });
  host.querySelectorAll("[data-film-soundscape]").forEach((ta) => {
    ta.oninput = () => {
      const i = Number(ta.dataset.filmSoundscape);
      if (state.film.clips[i]) state.film.clips[i].soundscape = ta.value;
      persistFilm();
    };
  });
  host.querySelectorAll("[data-film-dur]").forEach((inp) => {
    inp.onchange = () => {
      const i = Number(inp.dataset.filmDur);
      let n = parseInt(inp.value, 10);
      if (!Number.isFinite(n)) n = state.film.duration || 8;
      n = Math.max(4, Math.min(10, n));
      inp.value = String(n);
      if (state.film.clips[i]) state.film.clips[i].duration = n;
      persistFilm();
    };
  });
  host.querySelectorAll("[data-film-scene]").forEach((sel) => {
    sel.onchange = (e) => {
      e.stopPropagation();
      const i = Number(sel.dataset.filmScene);
      const clip = state.film.clips[i];
      if (!clip) return;
      clip.sceneLora = sceneLoraId(sel.value);
      SCENE_LORA_IDS.forEach((k) => { state.nsfwOn[k] = false; });
      if (clip.sceneLora) {
        armFilmSceneLora(clip);
      }
      persistFilm();
      syncSceneLoraChips();
    };
  });
  host.querySelectorAll("[data-film-rewrite]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      rewriteFilmClip(Number(btn.dataset.filmRewrite));
    };
  });
  host.querySelectorAll("[data-film-start]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      pickFilmStill(Number(btn.dataset.filmStart));
    };
  });
  host.querySelectorAll("[data-film-frame]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      pickFilmFrameVideo(Number(btn.dataset.filmFrame));
    };
  });
  host.querySelectorAll("[data-film-use-video]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openFilmVidPick(Number(btn.dataset.filmUseVideo), btn);
    };
  });
  host.querySelectorAll("[data-film-ref-still]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      generateFilmStill(Number(btn.dataset.filmRefStill));
    };
  });
  host.querySelectorAll("[data-film-clear-still]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.filmClearStill);
      const clip = state.film.clips[i];
      if (!clip) return;
      clip.firstName = null;
      clip.firstUrl = null;
      persistFilm();
      renderFilmClips();
    };
  });
  host.querySelectorAll("[data-film-clear]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.filmClear);
      const clip = state.film.clips[i];
      if (!clip) return;
      clip.prompt = "";
      clip.firstName = null;
      clip.firstUrl = null;
      clip.lastName = null;
      clip.result = null;
      clip.status = "idle";
      persistFilm();
      renderFilmClips();
    };
  });
  host.querySelectorAll("[data-film-insert-above]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.filmInsertAbove);
      state.film.clips.splice(i, 0, emptyFilmClip());
      state.film.selected = i;
      persistFilm();
      renderFilmClips();
    };
  });
  host.querySelectorAll("[data-film-insert]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.filmInsert);
      state.film.clips.splice(i + 1, 0, emptyFilmClip());
      state.film.selected = i + 1;
      persistFilm();
      renderFilmClips();
    };
  });
  host.querySelectorAll("[data-film-del]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (state.film.clips.length < 2) return;
      const i = Number(btn.dataset.filmDel);
      state.film.clips.splice(i, 1);
      state.film.selected = Math.min(state.film.selected, state.film.clips.length - 1);
      persistFilm();
      renderFilmClips();
    };
  });
}

function renderFilm() {
  ensureFilm();
  const bible = $("#filmBible");
  if (bible && bible !== document.activeElement) bible.value = state.film.bible || "";
  const cont = $("#filmContinue");
  if (cont) cont.checked = state.film.continue !== false;
  const dur = $("#filmDuration");
  if (dur && document.activeElement !== dur) dur.value = String(state.film.duration || 8);
  renderFilmChars();
  renderFilmWips();
  renderFilmHint();
  renderFilmClips();
  syncFilmGenAllLabel();
  syncSceneLoraChips();
}

function setFilmView(on) {
  ensureFilm();
  state.film.view = !!on;
  document.body.classList.toggle("film-on", state.film.view);
  const btn = $("#filmBtn");
  if (btn) btn.classList.toggle("on", state.film.view);
  if (state.film.view) {
    setUiMode("video", { keepPack: true });
    const h3 = (state.packs || []).find((p) => p.family === "h3" && p.ready) || state.pack;
    if (h3 && h3.family === "h3") selectPack(h3, { silent: true });
    if (state.aspect !== "16:9") {
      state.aspect = "16:9";
      syncAspectUi();
      syncSizeReadout();
    }
    setDuration(state.film.duration || 8);
    renderFilm();
  }
  if (typeof syncRefStrip === "function") syncRefStrip();
  if (typeof syncStageNav === "function") syncStageNav();
  syncSceneLoraChips();
}

function applyClipStartStillName(index, name, url) {
  const clip = state.film && state.film.clips[index];
  if (!clip || !name) return;
  clip.firstName = name;
  clip.firstUrl = url || charViewUrl(name);
  state.initName = name;
  state.initUrl = clip.firstUrl;
  if (typeof showInit === "function") showInit(clip.firstUrl);
  persistFilm();
  renderFilmClips();
  toast("Start still attached to clip " + (index + 1) + ".");
}

async function setClipStartStill(index, file) {
  if (!isImageFile(file)) {
    toast("Drop an image for the start still.", true);
    return;
  }
  try {
    const name = await uploadInit(file);
    applyClipStartStillName(index, name, URL.createObjectURL(file));
  } catch (e) {
    toast("Upload failed: " + (e && e.message ? e.message : e), true);
  }
}

async function handleStillDrop(index, files) {
  const list = files || [];
  const vid = list.find(isVideoDropFile);
  const img = list.find(isImageFile);
  if (vid) {
    openFilmFrameGrab(index, { file: vid });
    return;
  }
  if (img) {
    await setClipStartStill(index, img);
    return;
  }
  toast("Drop an image, or a video to grab a start-still frame.", true);
}

let filmFrameIndex = -1;
let filmFrameFile = null;
let filmFrameMedia = null;
let filmFrameObjectUrl = "";

function closeFilmFrameGrab() {
  filmFrameIndex = -1;
  filmFrameFile = null;
  filmFrameMedia = null;
  const dlg = $("#filmFrameDlg");
  if (dlg) dlg.hidden = true;
  const video = $("#filmFrameVideo");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  const seekHost = $("#filmFrameSeek");
  if (seekHost) seekHost.innerHTML = "";
  if (filmFrameObjectUrl) {
    try { URL.revokeObjectURL(filmFrameObjectUrl); } catch (_) {}
    filmFrameObjectUrl = "";
  }
}

function openFilmFrameGrab(index, opts) {
  opts = opts || {};
  const dlg = $("#filmFrameDlg");
  const video = $("#filmFrameVideo");
  const seekHost = $("#filmFrameSeek");
  if (!dlg || !video) {
    toast("Frame grab UI is missing. Reload the page.", true);
    return;
  }
  filmFrameIndex = index;
  filmFrameFile = opts.file || null;
  filmFrameMedia = opts.media || null;
  if (filmFrameObjectUrl) {
    try { URL.revokeObjectURL(filmFrameObjectUrl); } catch (_) {}
    filmFrameObjectUrl = "";
  }
  if (opts.file) {
    filmFrameObjectUrl = URL.createObjectURL(opts.file);
    video.src = filmFrameObjectUrl;
  } else if (opts.media && opts.media.filename) {
    video.src = opts.media.url || viewUrl(opts.media);
  } else {
    toast("Pick a video to grab a frame from.", true);
    return;
  }
  if (seekHost) {
    seekHost.innerHTML = "";
    seekHost.appendChild(makeVideoSeek(video));
  }
  dlg.hidden = false;
  try { video.currentTime = 0; } catch (_) {}
}

function pickFilmFrameVideo(index) {
  filmFrameIndex = index;
  const inp = $("#filmFrameFile");
  if (inp) {
    inp.value = "";
    inp.click();
    return;
  }
  const fallback = document.createElement("input");
  fallback.type = "file";
  fallback.accept = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv";
  fallback.onchange = () => {
    const file = fallback.files && fallback.files[0];
    if (file) openFilmFrameGrab(index, { file });
  };
  fallback.click();
}

async function useFilmFrame() {
  const index = filmFrameIndex;
  const video = $("#filmFrameVideo");
  if (index < 0 || !state.film || !state.film.clips[index]) {
    toast("No clip selected.", true);
    return;
  }
  const t = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
  try {
    toast("Grabbing frame…");
    let j;
    if (filmFrameFile) {
      const fd = new FormData();
      fd.append("file", filmFrameFile, filmFrameFile.name || "clip.mp4");
      fd.append("time", String(t));
      j = await apiFetch("/api/film/frame", { method: "POST", body: fd });
    } else if (filmFrameMedia && filmFrameMedia.filename) {
      j = await apiFetch("/api/film/frame", {
        method: "POST",
        body: JSON.stringify({
          filename: filmFrameMedia.filename,
          subfolder: filmFrameMedia.subfolder || "",
          type: filmFrameMedia.type || "output",
          time: t,
        }),
      });
    } else {
      toast("Pick a video first.", true);
      return;
    }
    if (!j || !j.ok || !(j.name || j.filename)) {
      throw new Error((j && j.error) || "frame grab failed");
    }
    const name = j.name || j.filename;
    closeFilmFrameGrab();
    applyClipStartStillName(index, name, viewUrl({ filename: name, type: "input", ts: Date.now() }));
  } catch (e) {
    toast("Could not grab that frame: " + (e && e.message ? e.message : e), true);
  }
}

function pickFilmStill(index) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (file) setClipStartStill(index, file);
  };
  input.click();
}

function recentHistoryVideos() {
  const seen = new Set();
  const out = [];
  [state.history, state.libHistory, state.gallery].forEach((list) => {
    (list || []).forEach((it) => {
      if (!it || !it.filename || it.exists === false) return;
      if (it.kind !== "video" && !isVideoFile(it.filename)) return;
      const k = (it.type || "output") + "/" + (it.subfolder || "") + "/" + it.filename;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(it);
    });
  });
  return out.slice(0, 32);
}

let filmVidPickIndex = -1;

function closeFilmVidPick() {
  filmVidPickIndex = -1;
  const box = $("#filmVidPick");
  if (box) box.hidden = true;
}

async function openFilmVidPick(index, anchor) {
  filmVidPickIndex = index;
  const box = $("#filmVidPick");
  const listEl = $("#filmVidPickList");
  if (!box || !listEl) return;
  if (!(state.libHistory || []).length) {
    try { await loadLibrary(); } catch (e) {}
  }
  const vids = recentHistoryVideos();
  listEl.innerHTML = vids.length
    ? vids.map((it, n) =>
      `<button type="button" class="film-vid-row" data-film-hist="${n}">` +
      `<span class="fn">${esc(it.filename)}</span>` +
      `<span class="meta">${esc([it.pack_title || it.pack || "History", fmtAgo(it.ts)].filter(Boolean).join(" · "))}</span>` +
      `</button>`
    ).join("")
    : `<div class="film-vid-empty">No history videos yet. Drop an mp4 onto this clip, or browse a file.</div>`;
  listEl.querySelectorAll("[data-film-hist]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const it = vids[Number(btn.dataset.filmHist)];
      closeFilmVidPick();
      if (it) assignClipVideo(index, it);
    };
  });
  box.hidden = false;
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 16, bottom: 80, right: 200 };
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 336));
  let top = r.bottom + 6;
  if (top + 280 > window.innerHeight) top = Math.max(8, r.top - 286);
  box.style.left = left + "px";
  box.style.top = top + "px";
}

async function rememberClipLastFrame(clip, media) {
  if (!media || !isVideoFile(media.filename)) return;
  const name = await pullLastFrame(media);
  clip.lastName = name;
}

async function assignClipVideo(index, media, opts) {
  opts = opts || {};
  const clip = state.film && state.film.clips[index];
  if (!clip || !media || !media.filename) {
    toast("No video to put on this clip.", true);
    return false;
  }
  clip.result = {
    filename: media.filename,
    subfolder: media.subfolder || "",
    type: media.type || "output",
    kind: "video",
    url: media.url || viewUrl(media),
  };
  clip.status = "done";
  try {
    await rememberClipLastFrame(clip, clip.result);
  } catch (e) {
    toast("Video on clip " + (index + 1) + ", but last frame failed: " + (e && e.message ? e.message : e), true);
  }
  persistFilm();
  renderFilmClips();
  if (!opts.silent) toast("Video on clip " + (index + 1) + ".");
  return true;
}

async function mediaFromVideoFile(file) {
  const name = (file && file.name) || "";
  const hit = recentHistoryVideos().find((v) => v.filename === name);
  if (hit) return hit;
  try {
    const fd = new FormData();
    fd.append("file", file, name);
    const j = await apiFetch("/api/film/upload", { method: "POST", body: fd });
    if (j && j.ok && j.filename) {
      return { filename: j.filename, subfolder: j.subfolder || "", type: j.type || "output", kind: "video" };
    }
  } catch (e) {}
  return { filename: name, subfolder: "", type: "output", kind: "video" };
}

async function handleClipDrop(index, files) {
  const list = files || [];
  const vid = list.find(isVideoDropFile);
  const img = list.find(isImageFile);
  if (vid) {
    const media = await mediaFromVideoFile(vid);
    await assignClipVideo(index, media);
    return;
  }
  if (img) {
    await setClipStartStill(index, img);
    return;
  }
  toast("Drop an image for the start still, or an mp4 for this clip’s video.", true);
}

async function rewriteFilmClip(index) {
  const clip = state.film && state.film.clips[index];
  if (!clip) return;
  const idea = assembleFilmIdea(clip);
  if (!idea) {
    toast("Write a shot first.", true);
    return;
  }
  const scene = armFilmSceneLora(clip) || sceneLoraId(clip.sceneLora) || activeSceneLora({ film_clip: clip.id });
  const path = filmPathFor(clip, index > 0 && state.film.continue && !clip.firstName);
  const packRefs = path === "r2v" ? filmR2VBundle(clip) : { refs: filmRefs(), tags: filmCharTags(), flags: filmSceneFlags() };
  const r2v = path === "r2v";
  try {
    const text = await window.ImagineRecipes.rewrite(idea, {
      recipe: "h3",
      pack: "h3",
      mode: path === "t2v" ? "t2v" : "i2v",
      has_image: !!clip.firstName && !r2v,
      nsfw: !!(state.nsfw || scene),
      h3_path: path,
      ref_count: packRefs.refs.length,
      has_last: false,
      character_tags: packRefs.tags,
      scene_flags: packRefs.flags,
      duration: clip.duration || (state.film && state.film.duration) || 8,
      want_audio: packWantsAudio(),
      film: true,
      scene_lora: scene,
      dialogue: clip.dialogue || "",
      soundscape: clip.soundscape || "",
      model: selectedRewriter(),
    });
    applyH3AudioToClip(clip, text);
    persistFilm();
    renderFilmClips();
    const err = window.ImagineRecipes && window.ImagineRecipes.lastError;
    if (err) toast(err, true);
    else toast(window.ImagineRecipes && window.ImagineRecipes.lastSource === "llm"
      ? "Clip " + (index + 1) + " rewritten with local model."
      : "Clip " + (index + 1) + " structured for this clip.");
  } catch (e) {
    toast("Rewrite failed: " + (e && e.message ? e.message : e), true);
  }
}

function filmR2VBundle(clip) {
  const refs = filmRefs();
  const tags = filmCharTags();
  const flags = filmSceneFlags();
  const start = clip && clip.firstName;
  if (!start) return { refs, tags, flags };
  return {
    refs: [start].concat(refs),
    tags: ["start still"].concat(tags),
    flags: [true].concat(flags),
  };
}

function filmPathFor(clip, prevLast) {
  const refs = filmRefs();
  const canR2V = !!(state.hasH3R2V && hasRef2va() && (refs.length || (clip && clip.firstName)));
  if (clipWantsCowgirl(clip) && canR2V) return "r2v";
  if (clip.firstName) return "i2v";
  if (state.film && state.film.continue && prevLast) return "i2v";
  if (refs.length && state.hasH3R2V && hasRef2va()) return "r2v";
  return "t2v";
}

function promptIsH3Structured(text) {
  return /integrated_multimodal_description\s*:/i.test(text || "");
}

function looksLikeShotDump(text) {
  const t = String(text || "");
  if (/\[Shot\s+\d+\]|integrated_multimodal_description|begins exactly from the composition|Keep identity|Picture 1 is the exact first frame|Same look:|Live-action|Throughout, the camera|overall_soundscape|matching the scene|medium-wide shot/i.test(t)) return true;
  if (t.length > 200 && /\b(camera|composition|lighting|first frame|bed|roof)\b/i.test(t)) return true;
  return false;
}

function isSpokenLine(text) {
  const t = String(text || "").trim().replace(/^["“”']+|["“”']+$/g, "");
  if (!t || /^none$/i.test(t)) return false;
  if (looksLikeShotDump(t)) return false;
  const words = t.split(/\s+/);
  if (t.length > 120 || words.length > 20) return false;
  if (/\b(camera|composition|begins exactly|live-action|photoreal|soundscape|keep identity|picture 1|matching the scene)\b/i.test(t)) return false;
  return true;
}

function isGenericSoundscape(text) {
  return /^(natural ambient (sound|room tone)( matching the scene)?([,.]?\s*under the spoken line)?|natural ambient room tone consistent with the scene|ambient sound matching the scene)\.?$/i.test(String(text || "").trim());
}

function shortSoundscape(text) {
  let t = String(text || "").trim();
  t = t.replace(/\b(matching the scene( only)?|under the spoken line|no speech|no narration|no narrator|no voiceover|diegetic only|consistent with the scene)\b/gi, "");
  t = t.replace(/\s{2,}/g, " ").replace(/^[.,;\s]+|[.,;\s]+$/g, "");
  if (!t || isGenericSoundscape(t) || looksLikeShotDump(t)) return "";
  const words = t.split(/\s+/);
  if (words.length > 15) t = words.slice(0, 15).join(" ");
  return t;
}

function peelH3Audio(text) {
  const raw = String(text || "");
  const fields = {};
  let current = null;
  const chunks = [];
  const keys = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music", "dialogue", "spoken_dialogue"];
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const low = trimmed.toLowerCase();
    let hit = null;
    keys.forEach((k) => {
      if (low.startsWith(k + ":")) hit = k;
    });
    if (hit) {
      if (current) fields[current] = chunks.join(" ").trim();
      current = hit;
      chunks.length = 0;
      const rest = trimmed.slice(hit.length + 1).trim();
      if (rest) chunks.push(rest);
    } else if (current) {
      chunks.push(trimmed);
    }
  });
  if (current) fields[current] = chunks.join(" ").trim();

  let visual = fields.integrated_multimodal_description || raw;
  visual = visual.replace(/^Picture 1 is the exact first frame[^\n]*\n?/i, "");
  visual = visual.replace(/^\[Shot\s+\d+\](?:\s+[\d.]+-[\d.]+s)?\s*/i, "");
  visual = visual.replace(/\bThe subject says:\s*[“"][^”"]*[”"]/gi, "");
  visual = visual.replace(/\bNo spoken dialogue\.\s*No voiceover\.\s*Do not read this prompt aloud\.?/gi, "");
  visual = visual.replace(/\[no speaker\]/gi, "");

  let dialogue = "";
  const labeled = String(fields.dialogue || fields.spoken_dialogue || "").trim().replace(/^["“]|["”]$/g, "");
  if (isSpokenLine(labeled)) {
    dialogue = labeled;
  }

  let soundscape = "";
  const sc = String(fields.overall_soundscape || "").trim();
  if (sc) soundscape = shortSoundscape(sc);
  if (!soundscape) {
    const sm = raw.match(/\bSoundscape(?:\s+later)?:\s*([^\n]+)/i);
    if (sm) soundscape = shortSoundscape(sm[1]);
  }

  visual = visual.replace(/\b(?:overall_soundscape|soundscape(?:\s+later)?)\s*:\s*[^\n]+/gi, "");
  visual = visual.replace(/\b(?:dialogue|spoken(?:\s+dialogue)?)\s*:\s*[^\n]+/gi, "");
  visual = visual.replace(/\bnon_diegetic_music\s*:\s*[^\n]+/gi, "");
  visual = visual.replace(/\bnatural ambient (?:sound|room tone)(?: matching the scene)?(?: only)?(?:[,.]?\s*under the spoken line)?/gi, "");
  visual = visual.replace(/\s{2,}/g, " ").trim();

  return { visual, dialogue, soundscape };
}

function peelShotIntoClip(clip) {
  if (!clip) return;
  const p = peelH3Audio(clip.prompt || "");
  const hadAudio = !!(p.dialogue || p.soundscape);
  if (hadAudio && p.visual && p.visual !== String(clip.prompt || "").trim()) {
    clip.prompt = p.visual;
  }
  if (looksLikeShotDump(clip.dialogue)) clip.dialogue = "";
  if (p.dialogue && isSpokenLine(p.dialogue) && !String(clip.dialogue || "").trim()) {
    clip.dialogue = p.dialogue;
  }
  const sc = shortSoundscape(p.soundscape || clip.soundscape || "");
  if (sc && !String(clip.soundscape || "").trim()) clip.soundscape = sc;
  if (looksLikeShotDump(clip.soundscape)) clip.soundscape = "";
}

function applyH3AudioToClip(clip, text) {
  if (!clip) return;
  const p = peelH3Audio(text);
  if (promptIsH3Structured(clip.prompt) && p.visual) clip.prompt = p.visual;
  else peelShotIntoClip(clip);
  if (p.dialogue && isSpokenLine(p.dialogue)) clip.dialogue = p.dialogue;
  else if (looksLikeShotDump(clip.dialogue)) clip.dialogue = "";
  const sc = shortSoundscape(p.soundscape || "");
  if (sc) clip.soundscape = sc;
  else if (looksLikeShotDump(clip.soundscape)) clip.soundscape = "";
}

function assembleFilmIdea(clip) {
  peelShotIntoClip(clip);
  if (!isSpokenLine(clip.dialogue || "none")) clip.dialogue = "";
  clip.soundscape = shortSoundscape(clip.soundscape || "");
  const bible = (state.film.bible || "").trim();
  const shot = (clip.prompt || "").trim();
  if (promptIsH3Structured(shot)) {
    const p = peelH3Audio(shot);
    return p.visual || shot;
  }
  if (bible && shot) return shot.replace(/[.!?]?$/, ".") + " Same look: " + bible;
  return shot || bible;
}

async function pullLastFrame(media) {
  const j = await apiFetch("/api/film/last-frame", {
    method: "POST",
    body: JSON.stringify({
      filename: media.filename,
      subfolder: media.subfolder || "",
      type: media.type || "output",
    }),
  });
  if (!j || !j.ok || !j.name) throw new Error((j && j.error) || "last frame failed");
  return j.name;
}

async function ensureContinueFrame(index) {
  const f = state.film;
  if (!f || !f.continue || index <= 0) return null;
  const clip = f.clips[index];
  if (clip && clip.firstName) return null;
  const prev = f.clips[index - 1];
  if (prev && prev.lastName) return prev.lastName;
  if (prev && clipHasVideo(prev)) {
    const name = await pullLastFrame(prev.result);
    prev.lastName = name;
    persistFilm();
    return name;
  }
  return null;
}

function filmFrameSize() {
  const mp = Number(state.videoMP) || 0.6;
  const ratio = aspectRatioValue() || (16 / 9);
  const target = mp * 1e6;
  const step = 32;
  const w = Math.max(step, Math.round(Math.sqrt(target * ratio) / step) * step);
  const h = Math.max(step, Math.round(Math.sqrt(target / ratio) / step) * step);
  return [w, h];
}

async function attachStillToClip(clip, media) {
  let name = media.filename;
  let url = viewUrl(media);
  if ((media.type || "output") !== "input") {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Could not read the still");
    const blob = await r.blob();
    const base = (media.filename || "still.png").split(/[/\\]/).pop();
    const file = new File([blob], base, { type: blob.type || "image/png" });
    name = await uploadInit(file);
    url = viewUrl({ filename: name, type: "input" });
  }
  clip.firstName = name;
  clip.firstUrl = url;
}

async function generateFilmStill(index) {
  if (!(await assertCanStart())) return false;
  ensureFilm();
  const clip = state.film.clips[index];
  if (!clip) {
    toast("No clip selected.", true);
    return false;
  }
  const idea = assembleFilmIdea(clip);
  if (!idea) {
    toast("Write a shot for clip " + (index + 1) + " first.", true);
    return false;
  }
  const refs = filmRefs();
  if (!refs.length) {
    toast("Add Character 1 and Character 2 first. Ref still uses those as identity, not the pose.", true);
    return false;
  }
  if (!hasRef2va()) {
    toast("Ref stills need Ref2VA weights. Use Start still and upload a posed photo instead.", true);
    return false;
  }
  if (!state.pack || state.pack.family !== "h3") {
    const h3 = (state.packs || []).find((p) => p.family === "h3" && p.ready);
    if (!h3) {
      toast("MiniMax H3 is not ready.", true);
      return false;
    }
    selectPack(h3, { silent: true });
  }
  setUiMode("image", { keepPack: true });
  const [fw, fh] = filmFrameSize();
  const params = buildJob({
    prompt: idea,
    mode: "t2i",
    init_image: null,
    last_image: null,
    ref_images: refs,
    h3_path: "r2v",
    width: fw,
    height: fh,
    megapixels: Number(state.videoMP) || 0.6,
    steps: 20,
    film_clip: clip.id,
    film_still: true,
    character_tags: filmCharTags(),
    scene_flags: filmSceneFlags(),
  });
  setUiMode("video", { keepPack: true });
  if (!params) return false;
  clip.status = "queued";
  state.film.selected = index;
  state.film.runAll = false;
  state.film.runIndex = index;
  persistFilm();
  renderFilmClips();
    if (state.running || state.submitting) {
      enqueueJob(params);
      toast("Queued ref still for clip " + (index + 1));
      updateQueueUi();
      return true;
    }
  clip.status = "running";
  renderFilmClips();
  state.running = true;
  plantJobPlaceholder(params, "running");
  updateQueueUi();
  toast("Ref still for clip " + (index + 1) + " — identity from Character 1/2, pose from the shot.");
  await submitJob(params);
  return true;
}

async function generateFilmClip(index, opts) {
  opts = opts || {};
  if (!opts.fromFinish && !(await assertCanStart())) return false;
  ensureFilm();
  const clip = state.film.clips[index];
  if (!clip) {
    toast("No clip selected.", true);
    return false;
  }
  if (opts.runAll && clipHasVideo(clip)) {
    const next = nextFilmNeedIndex(index + 1);
    if (next >= 0) return generateFilmClip(next, opts);
    toast("Nothing left to generate. Finished clips are skipped.");
    return false;
  }
  if (adoptComposerStill(clip, index)) persistFilm();
  const scene = armFilmSceneLora(clip) || sceneLoraId(clip.sceneLora) || activeSceneLora({ film_clip: clip.id });
  const idea = assembleFilmIdea(clip);
  if (!idea && !clip.firstName) {
    toast("Write a shot for clip " + (index + 1) + ", or attach a start still.", true);
    return false;
  }
  if (!state.pack || state.pack.family !== "h3") {
    const h3 = (state.packs || []).find((p) => p.family === "h3" && p.ready);
    if (!h3) {
      toast("MiniMax H3 is not ready.", true);
      return false;
    }
    selectPack(h3, { silent: true });
  }
  setUiMode("video", { keepPack: true });
  const clipSec = Number(clip.duration) || state.film.duration || 8;
  setDuration(clipSec);
  const startStill = clip.firstName || null;
  let continueFrame = null;
  if (!startStill) {
    try {
      continueFrame = await ensureContinueFrame(index);
    } catch (e) {
      toast("Could not pull the last frame for clip " + (index + 1) + ": " + (e && e.message ? e.message : e), true);
      return false;
    }
  }
  const prev = index > 0 ? state.film.clips[index - 1] : null;
  const prevLast = startStill ? null : (continueFrame || (prev && prev.lastName) || null);
  if (index > 0 && state.film.continue && !startStill && !prevLast) {
    toast("Clip " + (index + 1) + " is set to continue, but clip " + index + " has no last frame yet. Generate clip " + index + " first — not starting a new R2V scene.", true);
    return false;
  }
  const path = filmPathFor(clip, prevLast);
  const init = startStill || prevLast || null;
  const packRefs = path === "r2v" ? filmR2VBundle(clip) : { refs: filmRefs(), tags: filmCharTags(), flags: filmSceneFlags() };
  const refs = packRefs.refs;
  if (path === "t2v" && !init && refs.length && !hasRef2va()) {
    toast("Clip " + (index + 1) + " needs a posed start still. Identity portraits are not I2V first frames.", true);
    return false;
  }
  if (path === "r2v" && !clip.firstName) {
    toast("Clip " + (index + 1) + " has no start still — R2V will invent the opening pose.");
  }
  let prompt = idea;
  try {
    prompt = await window.ImagineRecipes.rewrite(idea, {
      recipe: "h3",
      pack: "h3",
      mode: path === "t2v" ? "t2v" : "i2v",
      has_image: !!init && path !== "r2v",
      nsfw: !!(state.nsfw || scene),
      h3_path: path,
      ref_count: refs.length,
      has_last: false,
      character_tags: packRefs.tags,
      scene_flags: packRefs.flags,
      duration: clipSec,
      want_audio: packWantsAudio(),
      film: true,
      scene_lora: scene,
      dialogue: clip.dialogue || "",
      soundscape: clip.soundscape || "",
      model: selectedRewriter(),
    });
  } catch (e) {}
  if (prompt && prompt !== idea) applyH3AudioToClip(clip, prompt);
  const params = buildJob({
    prompt,
    mode: path === "t2v" ? "t2v" : "i2v",
    init_image: path === "r2v" ? null : init,
    last_image: null,
    ref_images: path === "r2v" ? refs : [],
    h3_path: path,
    duration: clipSec,
    film_clip: clip.id,
    scene_lora: scene,
    character_tags: packRefs.tags,
    scene_flags: packRefs.flags,
    dialogue: clip.dialogue || "",
    soundscape: clip.soundscape || "",
    steps: path === "r2v" ? 20 : undefined,
  });
  if (!params) return false;
  const frameNote = path === "r2v"
    ? (startStill ? ("R2V from start still " + startStill + " + identity refs") : "R2V")
    : (startStill
      ? ("I2V from start still " + startStill)
      : (prevLast ? ("I2V continue from clip " + index + " last frame") : "T2V"));
  console.info("[film generate]", {
    clip: index + 1,
    id: clip.id,
    init: params.init_image || null,
    last: params.last_image || null,
    path,
    first_frame: startStill || prevLast || null,
    last_frame: null,
  });
  clip.status = "queued";
  state.film.selected = index;
  state.film.runAll = !!opts.runAll;
  state.film.runIndex = index;
  persistFilm();
  renderFilmClips();
  if (!opts.fromFinish && (state.running || state.submitting)) {
    if (index > 0 && state.film.continue && !init) {
      toast("Wait for clip " + index + " to finish so continue can use its last frame.", true);
      return false;
    }
    enqueueJob(params);
    toast("Queued clip " + (index + 1) + " — " + frameNote + " · " + state.queue.length + " waiting");
    updateQueueUi();
    return true;
  }
  clip.status = "running";
  renderFilmClips();
  if (!opts.fromFinish) {
    state.running = true;
    plantJobPlaceholder(params, "running");
    updateQueueUi();
  } else if (!params._job_key) {
    plantJobPlaceholder(params, "running");
  }
  toast("Generating clip " + (index + 1) + " — " + frameNote);
  await submitJob(params);
  return true;
}

async function generateFilmAll() {
  ensureFilm();
  const start = nextFilmNeedIndex(0);
  if (start < 0) {
    toast("Nothing left to generate. Finished clips are skipped.", true);
    return;
  }
  setFilmView(true);
  toast("Generating from clip " + (start + 1) + " — finished clips stay as they are.");
  await generateFilmClip(start, { runAll: true });
}

async function filmAfterClip(media) {
  const f = state.film;
  if (!f) {
    await kickQueue();
    return;
  }
  let i = f.runIndex;
  if (state.lastJob && state.lastJob.film_clip) {
    const hit = f.clips.findIndex((c) => c.id === state.lastJob.film_clip);
    if (hit >= 0) i = hit;
  }
  const makingStill = !!(state.lastJob && state.lastJob.film_still);
  const clip = f.clips[i];
  if (clip && media && makingStill) {
    try {
      await attachStillToClip(clip, media);
      clip.status = "idle";
      toast("Start still on clip " + (i + 1) + ". Check the pose, then generate that clip’s video.");
    } catch (e) {
      toast("Could not attach still: " + (e && e.message ? e.message : e), true);
    }
    persistFilm();
    renderFilmClips();
    f.runAll = false;
    await kickQueue();
    return;
  }
  if (clip && media) {
    const picked = pickFilmMedia(Array.isArray(media) ? media : [media]) || media;
    clip.result = asClipResult({
      filename: picked.filename,
      subfolder: picked.subfolder || "",
      type: picked.type || "output",
      kind: isVideoFile(picked.filename) ? "video" : (picked.kind || "image"),
      url: viewUrl({ ...picked, ts: Date.now() }),
    });
    clip.status = "done";
    persistFilm();
    renderFilmClips();
    const shown = (state.history || []).find((x) => x && x.filename === clip.result.filename)
      || Object.assign({}, clip.result, { kind: clip.result.kind });
    if (shown && shown.url) showInCanvas(shown);
    if (isVideoFile(clip.result.filename)) {
      try {
        await rememberClipLastFrame(clip, clip.result);
      } catch (e) {
        toast("Last frame extract failed: " + (e && e.message ? e.message : e), true);
      }
      persistFilm();
    }
  }
  if (f.runAll) {
    const next = nextFilmNeedIndex(i + 1);
    if (next >= 0) {
      const ok = await generateFilmClip(next, { runAll: true, fromFinish: true });
      if (ok) return;
      f.runAll = false;
    }
    f.runAll = false;
    f.runIndex = -1;
    persistFilm();
    toast("Film clips done. Stitch when you want the cut together.");
  }
  await kickQueue();
}

async function stitchFilm() {
  if (!state.film) return;
  const clips = state.film.clips.filter((c) => c.result && c.result.filename && isVideoFile(c.result.filename));
  if (clips.length < 2) {
    toast("Need at least two finished clips to stitch.", true);
    return;
  }
  try {
    const j = await apiFetch("/api/film/concat", {
      method: "POST",
      body: JSON.stringify({ clips: clips.map((c) => c.result) }),
    });
    if (!j.ok) throw new Error(j.error || "stitch failed");
    addResult(j);
    showInCanvas(state.history[0]);
    toast("Stitched " + clips.length + " clips.");
  } catch (e) {
    toast("Stitch failed: " + (e && e.message ? e.message : e), true);
  }
}

function bindFilmUi() {
  ensureFilm();
  const btn = $("#filmBtn");
  if (btn) btn.onclick = () => setFilmView(!state.film.view);
  const closeFilm = $("#closeFilm");
  if (closeFilm) closeFilm.onclick = () => setFilmView(false);
  const bible = $("#filmBible");
  if (bible) bible.oninput = () => {
    state.film.bible = bible.value;
    persistFilm();
  };
  const cont = $("#filmContinue");
  if (cont) cont.onchange = () => {
    state.film.continue = cont.checked;
    persistFilm();
  };
  const dur = $("#filmDuration");
  if (dur) dur.onchange = () => {
    let n = parseInt(dur.value, 10);
    if (!Number.isFinite(n)) n = 8;
    n = Math.max(4, Math.min(10, n));
    state.film.duration = n;
    dur.value = String(n);
    if (state.film.view) setDuration(n);
    persistFilm();
  };
  const add = $("#filmAddClip");
  if (add) add.onclick = () => {
    state.film.clips.push(emptyFilmClip());
    persistFilm();
    renderFilmClips();
  };
  const addChar = $("#filmAddChar");
  if (addChar) addChar.onclick = () => {
    if (!state.film.characters) state.film.characters = [];
    state.film.characters.push(emptyFilmChar());
    persistFilm();
    renderFilmChars();
    renderFilmHint();
  };
  const reset = $("#filmReset");
  if (reset) reset.onclick = resetFilmBoard;
  const saveWip = $("#filmSaveWip");
  if (saveWip) saveWip.onclick = saveFilmWip;
  const loadWip = $("#filmLoadWip");
  if (loadWip) loadWip.onclick = loadPickedWip;
  const exportWip = $("#filmExportWip");
  if (exportWip) exportWip.onclick = exportFilmSnap;
  const importWip = $("#filmImportWip");
  if (importWip) importWip.onclick = pickFilmImport;
  const importFile = $("#filmImportFile");
  if (importFile) importFile.onchange = async () => {
    const file = importFile.files && importFile.files[0];
    importFile.value = "";
    if (!file) return;
    try { await importFilmFile(file); } catch (e) {
      toast(e && e.message ? e.message : "Import failed.", true);
    }
  };
  const vidBrowse = $("#filmVidBrowse");
  if (vidBrowse) vidBrowse.onclick = (e) => {
    e.stopPropagation();
    const inp = $("#filmVidFile");
    if (inp) inp.click();
  };
  const frameDlg = $("#filmFrameDlg");
  if (frameDlg) frameDlg.addEventListener("click", (e) => {
    if (e.target === frameDlg) closeFilmFrameGrab();
  });
  const frameUse = $("#filmFrameUse");
  if (frameUse) frameUse.onclick = (e) => {
    e.stopPropagation();
    useFilmFrame();
  };
  const frameCancel = $("#filmFrameCancel");
  if (frameCancel) frameCancel.onclick = (e) => {
    e.stopPropagation();
    closeFilmFrameGrab();
  };
  const framePick = $("#filmFramePick");
  if (framePick) framePick.onclick = (e) => {
    e.stopPropagation();
    pickFilmFrameVideo(filmFrameIndex >= 0 ? filmFrameIndex : (state.film && state.film.selected) || 0);
  };
  const frameFile = $("#filmFrameFile");
  if (frameFile) frameFile.onchange = () => {
    const file = frameFile.files && frameFile.files[0];
    frameFile.value = "";
    const index = filmFrameIndex >= 0 ? filmFrameIndex : (state.film && state.film.selected);
    if (!file || index == null || index < 0) return;
    openFilmFrameGrab(index, { file });
  };
  const vidFile = $("#filmVidFile");
  if (vidFile) vidFile.onchange = async () => {
    const file = vidFile.files && vidFile.files[0];
    vidFile.value = "";
    const index = filmVidPickIndex;
    closeFilmVidPick();
    if (!file || index < 0) return;
    try {
      const media = await mediaFromVideoFile(file);
      await assignClipVideo(index, media);
    } catch (e) {
      toast(e && e.message ? e.message : "Could not use that video.", true);
    }
  };
  document.addEventListener("click", (e) => {
    const box = $("#filmVidPick");
    if (!box || box.hidden) return;
    if (box.contains(e.target) || e.target.closest("[data-film-use-video]")) return;
    closeFilmVidPick();
  });
  refreshDiskStories();
  const one = $("#filmGenOne");
  if (one) one.onclick = () => generateFilmClip(state.film.selected, { runAll: false });
  const all = $("#filmGenAll");
  if (all) all.onclick = generateFilmAll;
  const stitch = $("#filmStitch");
  if (stitch) stitch.onclick = stitchFilm;
  renderFilm();
}

function bindRefUi() {
  ensureComposerRefs();
  const add = $("#refAdd");
  if (add) add.onclick = () => {
    const slots = ensureComposerRefs();
    if (slots.length >= REF_SLOT_MAX) {
      toast("At most " + REF_SLOT_MAX + " reference pictures.", true);
      return;
    }
    slots.push(emptyCharSlot());
    persistComposerRefs();
    renderComposerRefs();
  };
  syncRefStrip();
}

function composerJobOverride() {
  const p = state.pack;
  if (state.uiMode === "image") {
    return { init_image: null, ref_images: [], h3_path: "", character_tags: [], scene_flags: [] };
  }
  if (state.uiMode === "ref_image" && p && p.family === "h3") {
    return {
      mode: "t2i",
      init_image: null,
      ref_images: composerRefNames(),
      h3_path: "r2v",
      film_still: true,
      character_tags: composerCharTags(),
      scene_flags: composerSceneFlags(),
    };
  }
  if (state.uiMode === "video" && p && p.family === "h3") {
    if (cowgirlFilePicked() && hasRef2va() && (state.initName || composerRefNames().length)) {
      const names = composerRefNames();
      const tags = composerCharTags();
      const flags = composerSceneFlags();
      return {
        mode: "i2v",
        init_image: null,
        ref_images: state.initName ? [state.initName].concat(names) : names,
        h3_path: "r2v",
        character_tags: state.initName ? [""].concat(tags) : tags,
        scene_flags: state.initName ? [true].concat(flags) : flags,
      };
    }
    if (state.initName) {
      return {
        mode: "i2v",
        init_image: state.initName,
        ref_images: [],
        h3_path: "i2v",
        character_tags: [],
        scene_flags: [],
      };
    }
    if (composerRefNames().length && hasRef2va()) {
      return {
        mode: "i2v",
        init_image: null,
        ref_images: composerRefNames(),
        h3_path: "r2v",
        character_tags: composerCharTags(),
        scene_flags: composerSceneFlags(),
      };
    }
    return { mode: "t2v", init_image: null, ref_images: [], h3_path: "t2v", character_tags: [], scene_flags: [] };
  }
  return { ref_images: [], h3_path: "", character_tags: [], scene_flags: [] };
}
async function generate() {
  try {
    if (!(await assertCanStart())) return;
    if (state.film && state.film.view) {
      await generateFilmAll();
      return;
    }
    if (state.uiMode === "ref_image") {
      if (!composerRefNames().length) {
        toast("Add at least one reference image.", true);
        return;
      }
      if (state.pack && packCanMultiRef(state.pack)) {
        if (!hasRef2va()) {
          toast("Ref stills need Ref2VA weights.", true);
          return;
        }
      } else {
        warnWeakR2I(state.pack);
      }
    }
    if (state.uiMode === "video" && !state.initName && composerRefNames().length) {
      if (!ensureH3ForIdentity("Reference-to-video needs MiniMax H3. Attach a start still for I2V, or pick H3.")) return;
      if (!hasRef2va()) {
        toast("Identity refs need Ref2VA. Attach a start still for I2V instead.", true);
        return;
      }
      toast("No start still — R2V will invent the pose from the face crops.");
    }
    const params = buildJob(composerJobOverride());
    if (!params) return;
    if (state.running || state.submitting) {
      enqueueJob(params);
      toast("Queued behind current job · " + state.queue.length + " waiting");
      updateQueueUi();
      return;
    }
    state.running = true;
    plantJobPlaceholder(params, "running");
    updateQueueUi();
    await submitJob(params);
  } catch (e) {
    toast("Send failed: " + (e && e.message ? e.message : e), true);
    console.error(e);
    state.running = false;
    updateQueueUi();
  }
}

function jobIsStill(h3Path, filmStill, mode) {
  if (filmStill) return true;
  const m = String(mode || "").toLowerCase();
  if (m === "t2i" || m === "i2i" || m === "edit" || m === "r2i") return true;
  if (state.uiMode === "image" && h3Path !== "i2v" && h3Path !== "t2v") return true;
  return false;
}

function packStillDefaultAfterMidnight() {
  const rec = ((state.pack && state.pack.nsfw_loras) || []).find((l) => l.id === "aftermidnight");
  return !!(rec && (rec.still || rec.still_on || rec.still_default));
}

function loraNameIsVideoScene(n) {
  n = (n || "").toLowerCase();
  return /hmmasturb|masturb/.test(n) || /finger/.test(n) || /cowgirl/.test(n) || /pinkfluffy/.test(n);
}

function lorasForJob(h3Path, filmStill, hasLast, scene, mode) {
  const still = jobIsStill(h3Path, filmStill, mode);
  scene = still ? "" : sceneLoraId(scene);
  const chain = loraChain({ scene }) || [];
  const nameOf = (l) => ((l && l.name) || "").toLowerCase();
  const sceneHit = (l) => {
    const n = nameOf(l);
    if (scene === "cowgirl") return /cowgirl/.test(n);
    if (scene === "fingering") return /finger/.test(n);
    if (scene === "masturbation") return /hmmasturb|masturb/.test(n);
    return false;
  };
  let out = chain;
  if (still) {
    out = out.filter((l) => !loraNameIsVideoScene(nameOf(l)));
    if (!packStillDefaultAfterMidnight()) {
      out = out.filter((l) => !/aftermidnight/.test(nameOf(l)));
    }
  }
  if (filmStill) out = out.filter((l) => !/turbo/i.test(nameOf(l)));
  if (!(state.pack && state.pack.family === "h3")) return out;
  const r2v = h3Path === "r2v" || !!filmStill;
  if (r2v) out = out.filter((l) => !/turbo/i.test(nameOf(l)));
  const keepExplicit = (l) => {
    if (still || !sceneHit(l)) return false;
    if (r2v && (scene === "fingering" || scene === "masturbation")) return false;
    return true;
  };
  if (r2v || !hasLast) out = out.filter((l) => keepExplicit(l) || !/fl2v/.test(nameOf(l)));
  if (r2v) return out;
  return out.filter((l) => keepExplicit(l) || !/ref2v/.test(nameOf(l)));
}

function buildJob(over) {
  over = over || {};
  if (!state.wantConnect) {
    toast("Connect ComfyUI first.", true);
    return null;
  }
  if (!state.online) {
    toast("ComfyUI is offline. Start it, then Connect.", true);
    return null;
  }
  const p = state.pack;
  if (!p) {
    toast("Pick a model card first.", true);
    return null;
  }
  if (!p.ready) {
    toast("This pack is missing files. Open the pack panel to see what to add.", true);
    openInspector();
    return null;
  }
  const init = over.init_image !== undefined
    ? over.init_image
    : (attachOn() ? state.initName : null);
  const last = over.last_image !== undefined ? over.last_image : null;
  let refs = over.ref_images || [];
  let h3Path = over.h3_path || "";
  const mode = over.mode || genMode();
  if (p.family !== "h3") {
    refs = [];
    h3Path = "";
  }
  const needsPhoto = (mode === "edit" || mode === "i2i" || mode === "i2v") && h3Path !== "r2v" && h3Path !== "t2v";
  if (needsPhoto && !init) {
    toast("Add a photo first.", true);
    return null;
  }
  let prompt = over.prompt !== undefined ? over.prompt : (($("#idea") && $("#idea").value) || "");
  if (!String(prompt).trim() && mode !== "i2v" && h3Path !== "i2v") {
    toast("Write a prompt first. ✦ can structure it.", true);
    return null;
  }
  const [w, h] = size();
  const r = resolved();
  const unet = (h3Path === "r2v" && r.ref_unet) ? r.ref_unet : (over.unet || r.unet);
  const still = jobIsStill(h3Path, over.film_still, mode);
  const scene = still ? "" : (sceneLoraId(over.scene_lora) || activeSceneLora(over));
  const loras = lorasForJob(h3Path, over.film_still, !!last, scene, mode);
  const loraBlob = loras.map((l) => ((l && l.name) || "").toLowerCase()).join(" ");
  if (p.family === "h3" && /realism-people|h3-realism/.test(loraBlob) && !/r34l1sm/i.test(prompt)) {
    prompt = "r34l1sm, " + prompt;
  }
  let scheduler = $("#scheduler").value;
  if (p.family === "h3" && /aftermidnight/.test(loraBlob) && (h3Path === "r2v" || over.film_still)) {
    scheduler = "beta";
  }
  return {
    graph: p.graph,
    family: p.family,
    clip_type: p.clip_type,
    mode,
    client_id: state.clientId,
    resolved: r,
    unet,
    ref_unet: r.ref_unet || "",
    clip: pickClip(),
    vae: r.vae,
    audio_vae: r.audio_vae,
    prompt,
    prompt_recipe: p.prompt_recipe,
    nsfw: !!(state.nsfw || scene),
    neg: combinedNeg(p),
    steps: over.steps !== undefined ? over.steps : $("#steps").value,
    cfg: $("#cfg").value,
    denoise: $("#denoise").value,
    sampler: $("#sampler").value,
    scheduler,
    width: over.width || w,
    height: over.height || h,
    megapixels: over.megapixels || currentMP(),
    seed: $("#seed").value,
    duration: over.duration !== undefined ? over.duration : readDuration(),
    fps: (p.defaults && p.defaults.fps) || 24,
    loras,
    scene_lora: scene,
    init_image: (h3Path === "r2v" || state.uiMode === "image") ? null : init,
    last_image: last,
    ref_images: refs,
    h3_path: h3Path,
    film_clip: over.film_clip || null,
    film_still: !!over.film_still,
    character_tags: p.family === "h3" ? (over.character_tags || []) : [],
    scene_flags: p.family === "h3" ? (over.scene_flags || []) : [],
    dialogue: over.dialogue || "",
    soundscape: over.soundscape || "",
    music: over.music || "",
    shift: p.defaults && p.defaults.shift,
    pack_id: p.id,
    pack_title: p.title,
  };
}

async function submitJob(params) {
  state.submitting = true;
  try {
    const body = Object.assign({}, params);
    delete body._job_key;
    const j = await apiFetch("/api/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!j.ok) {
      toast("Rejected: " + String(j.error || "").slice(0, 220), true);
      removePlaceholder(params && params._job_key);
      state.submitting = false;
      await kickQueue();
      return;
    }
    const skipped = j.skipped_loras || [];
    if (skipped.length) {
      const names = skipped.map((s) => s.name + " (" + (s.label || s.family) + ")").join(", ");
      toast("Skipped LoRA(s) that do not fit this model: " + names, true);
    }
    state.promptId = j.prompt_id;
    state.currentPrompt = params.prompt;
    state.jobPackId = params.pack_id || (state.pack && state.pack.id) || null;
    state.jobPackTitle = params.pack_title || (state.pack && state.pack.title) || null;
    state.jobFamily = params.family || (state.pack && state.pack.family) || null;
    state.jobStartedAt = Date.now();
    state.lastJob = snapshotSettings(params);
    const ph = activateJobPlaceholder(params, j.prompt_id);
    if (ph) showInCanvas(ph);
    else renderHistory();
    startRun();
    persistRun();
    watchPrompt(state.promptId);
  } catch (e) {
    toast("Failed to queue: " + e.message, true);
    removePlaceholder(params && params._job_key);
    state.submitting = false;
    await kickQueue();
    return;
  }
  state.submitting = false;
}

function queueNote(base) {
  const n = state.queue.length;
  return n ? base + " · " + n + " waiting" : base;
}

function updateQueueUi() {
  const running = !!(state.running || state.queue.length);
  document.body.classList.toggle("job-on", running);
  const stop = $("#stop");
  if (stop) stop.classList.toggle("show", running);
  const go = $("#go");
  if (go) {
    const n = state.queue.length;
    go.title = state.running ? (n ? "Queue another (" + n + " waiting)" : "Queue another") : "Generate";
  }
  if (typeof renderStageActions === "function") renderStageActions();
}

function stopWatching() {
  if (watchPrompt._t) {
    clearInterval(watchPrompt._t);
    watchPrompt._t = null;
  }
}

function clearStuckRunFlags() {
  if (state.stopping) return false;
  if ((state.running || state.submitting) && !state.promptId) {
    state.running = false;
    state.submitting = false;
    updateQueueUi();
    return true;
  }
  return false;
}

async function waitComfyIdle(ms) {
  const deadline = Date.now() + (Number(ms) || 6000);
  while (Date.now() < deadline) {
    try {
      const q = await apiFetch("/api/queue");
      const running = (q && q.queue_running) || [];
      const pending = (q && q.queue_pending) || [];
      if (!running.length && !pending.length) return true;
    } catch (e) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function assertCanStart() {
  if (state.stopping) {
    toast("Still stopping — wait a moment.", true);
    return false;
  }
  clearStuckRunFlags();
  if (state.stoppedAt && Date.now() - state.stoppedAt < 15000) {
    try {
      const q = await apiFetch("/api/queue");
      if (((q && q.queue_running) || []).length) {
        toast("Still stopping — wait a moment.", true);
        return false;
      }
    } catch (e) {}
    state.stoppedAt = 0;
  }
  return true;
}

async function kickQueue() {
  if (state.stopping || state.submitting) return;
  const next = state.queue.shift();
  updateQueueUi();
  if (!next) {
    state.currentJobKey = null;
    finishRun();
    sweepIdlePlaceholders();
    return;
  }
  state.promptId = null;
  activateQueuedPlaceholder(next);
  setProgress(0, queueNote("next in queue…"));
  await submitJob(next);
}

function isPendingItem(it) {
  if (!it) return false;
  if (it.pending || it.kind === "pending") return true;
  const fn = String(it.filename || "");
  return fn.indexOf("__pending__") === 0;
}

function isCurrentJobItem(it) {
  if (!it || !state.running) return false;
  if (state.promptId && it.prompt_id && String(it.prompt_id) === String(state.promptId)) return true;
  if (state.currentJobKey && it.job_key && it.job_key === state.currentJobKey) return true;
  return false;
}

function veilShouldShow() {
  return !!(state.running && state.shown && isCurrentJobItem(state.shown));
}

function syncVeil() {
  const veil = $("#veil");
  if (!veil) return;
  if (veilShouldShow()) veil.classList.add("on");
  else veil.classList.remove("on");
}

function fillPromptBar(it) {
  const el = $("#idea");
  if (!el || !it) return;
  const text = String(it.prompt || "").replace(/\s+/g, " ").trim();
  if (text) el.value = text;
}

function clearFrameMedia() {
  const frame = $("#frame");
  if (!frame) return;
  [...frame.querySelectorAll(".stage-player,.stage-pending")].forEach((n) => n.remove());
  [...frame.querySelectorAll("img,video")].forEach((n) => {
    if (n.id === "livePreview") return;
    n.remove();
  });
}

function nextJobKey() {
  nextJobKey._n = (nextJobKey._n || 0) + 1;
  return "job-" + Date.now() + "-" + nextJobKey._n;
}

function guessJobKind(params) {
  params = params || {};
  if (params.film_still) return "image";
  const mode = params.mode || "";
  if (mode === "t2v" || mode === "i2v") return "video";
  if (mode === "t2i" || mode === "i2i" || mode === "edit") return "image";
  if (state.uiMode === "video") return "video";
  return "image";
}

function makeJobPlaceholder(params, status, extra) {
  extra = extra || {};
  const key = extra.job_key || nextJobKey();
  return {
    kind: "pending",
    media_kind: guessJobKind(params),
    pending: true,
    status: status || "queued",
    prompt: (params && params.prompt) || "",
    pack: (params && params.pack_id) || "",
    pack_title: (params && params.pack_title) || "",
    ts: Date.now(),
    prompt_id: extra.prompt_id || "",
    job_key: key,
    filename: "__pending__" + key,
    subfolder: "",
    type: "pending",
    exists: true,
    url: "",
    pct: status === "running" ? (Number(state.lastPct) || 0) : 0,
    settings: extra.settings || null,
  };
}

function unshiftHistory(it) {
  state.history = [it].concat((state.history || []).filter((x) => !sameMedia(x, it)));
}

function mediaStripKey(it) {
  if (!it) return "";
  if (it.job_key) return "job:" + it.job_key;
  return (it.type || "output") + "/" + (it.subfolder || "") + "/" + (it.filename || "");
}

function plantJobPlaceholder(params, status) {
  status = status || "queued";
  const key = params && params._job_key;
  let ph = key ? (state.history || []).find((x) => x && x.job_key === key) : null;
  if (ph) {
    ph.status = status;
    ph.pending = true;
    ph.kind = "pending";
  } else {
    ph = makeJobPlaceholder(params, status);
    if (params) params._job_key = ph.job_key;
    unshiftHistory(ph);
  }
  if (status === "running") state.currentJobKey = ph.job_key;
  renderHistory();
  persistFeed();
  if (status === "running") showInCanvas(ph);
  return ph;
}

function enqueueJob(params) {
  const ph = plantJobPlaceholder(params, "queued");
  if (params) params._job_key = ph.job_key;
  state.queue.push(params);
  updateQueueUi();
  return ph;
}

function activateQueuedPlaceholder(params) {
  const key = params && params._job_key;
  const ph = key && (state.history || []).find((x) => x && x.job_key === key);
  if (ph) {
    ph.status = "running";
    ph.pending = true;
    state.currentJobKey = ph.job_key;
    showInCanvas(ph);
    return ph;
  }
  state.currentJobKey = key || state.currentJobKey;
  return null;
}

function activateJobPlaceholder(params, promptId) {
  const key = params && params._job_key;
  let ph = key ? (state.history || []).find((x) => x && x.job_key === key) : null;
  if (!ph && promptId) {
    ph = (state.history || []).find((x) => x && isPendingItem(x) && x.prompt_id === promptId);
  }
  if (ph) {
    ph.status = "running";
    ph.prompt_id = promptId || ph.prompt_id;
    ph.pending = true;
    ph.kind = "pending";
  } else {
    ph = makeJobPlaceholder(params, "running", { prompt_id: promptId });
    unshiftHistory(ph);
  }
  state.currentJobKey = ph.job_key;
  renderHistory();
  persistFeed();
  return ph;
}

function removePlaceholder(key) {
  if (!key) return;
  state.history = (state.history || []).filter((x) => !x || x.job_key !== key);
  if (state.shown && state.shown.job_key === key) {
    const next = state.history[0];
    if (next) showInCanvas(next);
    else showHomeStage();
  } else {
    renderHistory();
  }
  persistFeed();
}

function clearPendingPlaceholders() {
  state.history = (state.history || []).filter((x) => !isPendingItem(x));
  if (state.shown && isPendingItem(state.shown)) {
    const next = state.history[0];
    if (next) showInCanvas(next);
    else showHomeStage();
  } else {
    renderHistory();
  }
  persistFeed();
}

function jobIsLive() {
  return !!(state.running || state.submitting || state.promptId || (state.queue || []).length);
}

function pendingMatchesOutput(it, live) {
  if (!it || !isPendingItem(it) || !it.prompt_id) return false;
  return (live || []).some((y) => y && y.prompt_id && String(y.prompt_id) === String(it.prompt_id));
}

function keepPendingItem(it, live) {
  if (!it || !isPendingItem(it)) return false;
  if (pendingMatchesOutput(it, live)) return false;
  if (!jobIsLive()) return false;
  if (it.status === "queued") return true;
  if (isCurrentJobItem(it)) return true;
  if (state.promptId && it.prompt_id && String(it.prompt_id) === String(state.promptId)) return true;
  if (state.currentJobKey && it.job_key === state.currentJobKey) return true;
  return false;
}

function pendingMatchesJob(it, pid) {
  if (!it || !isPendingItem(it)) return false;
  if (pid && it.prompt_id && String(it.prompt_id) === String(pid)) return true;
  if (state.currentJobKey && it.job_key === state.currentJobKey) return true;
  if (pid && it.status === "running") {
    const running = (state.history || []).filter((x) => isPendingItem(x) && x.status === "running");
    if (running.length === 1 && running[0] === it) return true;
  }
  return false;
}

function dropJobPlaceholder(pid) {
  const hist = state.history || [];
  if (!hist.some((x) => pendingMatchesJob(x, pid))) return;
  state.history = hist.filter((x) => !pendingMatchesJob(x, pid));
  if (state.shown && pendingMatchesJob(state.shown, pid)) {
    const next = state.history[0];
    if (next) showInCanvas(next);
    else showHomeStage();
  } else {
    renderHistory();
  }
  persistFeed();
}

function discardIdlePlaceholders() {
  // Empty Comfy queue: drop leftover __pending__ strip zombies.
  state.queue = [];
  clearPendingPlaceholders();
  finishRun();
  state.lastPct = 0;
  try { sessionStorage.removeItem("yi-run"); } catch (e) {}
  syncVeil();
}

function sweepIdlePlaceholders() {
  const hist = state.history || [];
  const live = hist.filter((x) => x && !isPendingItem(x));
  const next = hist.filter((x) => !isPendingItem(x) || keepPendingItem(x, live));
  if (next.length === hist.length) {
    syncVeil();
    return;
  }
  state.history = next;
  if (state.shown && isPendingItem(state.shown) && !keepPendingItem(state.shown, live)) {
    const shown = state.history[0];
    if (shown) showInCanvas(shown);
    else showHomeStage();
  } else {
    renderHistory();
  }
  persistFeed();
  syncVeil();
}

function ensureRunningPlaceholder() {
  if (!state.promptId) return null;
  let ph = (state.history || []).find((x) => isPendingItem(x) && x.prompt_id === state.promptId);
  if (ph) {
    ph.status = "running";
    state.currentJobKey = ph.job_key || state.currentJobKey;
    pruneExtraRunningPlaceholders(ph);
    return ph;
  }
  if (state.currentJobKey) {
    ph = (state.history || []).find((x) => x && x.job_key === state.currentJobKey);
    if (ph) {
      ph.status = "running";
      ph.prompt_id = state.promptId;
      ph.pending = true;
      pruneExtraRunningPlaceholders(ph);
      return ph;
    }
  }
  ph = makeJobPlaceholder({
    prompt: state.currentPrompt || "",
    pack_id: state.jobPackId,
    pack_title: state.jobPackTitle,
    mode: state.jobFamily === "h3" && state.uiMode === "video" ? "t2v" : "t2i",
  }, "running", { prompt_id: state.promptId, job_key: state.currentJobKey || nextJobKey() });
  state.currentJobKey = ph.job_key;
  unshiftHistory(ph);
  pruneExtraRunningPlaceholders(ph);
  renderHistory();
  persistFeed();
  return ph;
}

function pruneExtraRunningPlaceholders(keep) {
  if (!keep) return;
  state.history = (state.history || []).filter((x) => {
    if (!isPendingItem(x) || x.status !== "running") return true;
    return x === keep || (keep.job_key && x.job_key === keep.job_key);
  });
}

const progressStore = { pct: 0, note: "" };

function liveProgressPct() {
  const n = Number(progressStore.pct);
  return Number.isFinite(n) ? n : (Number(state.lastPct) || 0);
}

function patchRunningPlaceholder(pct) {
  const n = Math.round(Number(pct != null ? pct : liveProgressPct()) || 0);
  progressStore.pct = n;
  state.lastPct = n;
  (state.history || []).forEach((it) => {
    if (it && isPendingItem(it) && isCurrentJobItem(it)) {
      it.pct = n;
      it.status = "running";
    }
  });
  if (state.shown && isPendingItem(state.shown) && isCurrentJobItem(state.shown)) {
    state.shown.pct = n;
  }
  const strip = $("#strip");
  if (strip && state.currentJobKey) {
    const cell = strip.querySelector('.item[data-job-key="' + state.currentJobKey + '"] .pending-pct');
    if (cell) cell.textContent = n + "%";
  }
  const stagePct = $("#stagePendingPct");
  if (stagePct && veilShouldShow()) stagePct.textContent = n + "%";
}

function setProgress(pct, note) {
  const pctEl = $("#veilPct");
  const noteEl = $("#veilNote");
  const raw = Number(pct);
  const n = Math.max(0, Math.min(100, Math.round(Number.isFinite(raw) ? raw : 0)));
  progressStore.pct = n;
  if (note) progressStore.note = note;
  state.lastPct = n;
  if (pctEl) pctEl.textContent = n + "%";
  if (noteEl && note) noteEl.textContent = note;
  patchRunningPlaceholder(n);
  syncVeil();
  persistRun();
}

function nodePhaseNote(nodeId) {
  const id = String(nodeId || "");
  const map = {
    "1": "loading UNet…",
    "2": "loading CLIP…",
    "3": "loading VAE…",
    "4": "loading audio VAE…",
    "12": "encoding H3 prompt…",
    "30": "sampling…",
    "8": "decoding frames…",
    "10": "decoding audio…",
    "11": "muxing video…",
    "9": "saving…",
  };
  return map[id] || ("node " + id);
}

function firstFinite() {
  for (let i = 0; i < arguments.length; i++) {
    const x = arguments[i];
    if (x == null || x === "") continue;
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function collectProgressPairs(obj) {
  if (!obj || typeof obj !== "object") return [];
  const out = [];
  const nested = obj.progress;
  if (nested && typeof nested === "object" && nested !== obj) {
    out.push.apply(out, collectProgressPairs(nested));
  } else if (typeof nested === "number" && Number.isFinite(nested)) {
    if (nested >= 0 && nested <= 1) out.push({ value: nested, max: 1 });
    else if (nested > 1 && nested <= 100) out.push({ value: nested, max: 100 });
  }
  [
    [obj.value, obj.max],
    [obj.current, obj.total],
    [obj.step, obj.steps],
    [obj.current_step, obj.total_steps],
  ].forEach((pair) => {
    const value = Number(pair[0]);
    const max = Number(pair[1]);
    if (Number.isFinite(value) && Number.isFinite(max) && max > 0) out.push({ value, max });
  });
  return out;
}

function preferProgressPair(pairs) {
  if (!pairs || !pairs.length) return null;
  const live = pairs.filter((p) => p.max > 1 && p.value >= 1);
  if (live.length) {
    return live.sort((a, b) => (b.value / b.max) - (a.value / a.max) || b.value - a.value)[0];
  }
  const frac = pairs.filter((p) => p.max === 1 && p.value > 0 && p.value < 1);
  if (frac.length) return frac.sort((a, b) => b.value - a.value)[0];
  const pct = pairs.filter((p) => p.max === 1 && p.value > 1 && p.value <= 100);
  if (pct.length) return pct.sort((a, b) => b.value - a.value)[0];
  return null;
}

function pairFromFields(obj) {
  return preferProgressPair(collectProgressPairs(obj));
}

function readProgressPair(obj) {
  return preferProgressPair(collectProgressPairs(obj));
}

function pairRatio(pair) {
  if (!pair) return null;
  const value = Number(pair.value);
  const max = Number(pair.max);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  if (max === 1) {
    if (value > 0 && value < 1) return value;
    if (value > 1 && value <= 100) return value / 100;
    return null;
  }
  return Math.min(1, Math.max(0, value / max));
}

function pairDisplayPct(pair) {
  const r = pairRatio(pair);
  if (r == null) return null;
  return 100 * r;
}

function nodeSamplerBoost(id, pair) {
  const nid = String(id || "");
  const label = String((pair && (pair.class_type || pair.node_type || pair.type)) || "").toLowerCase();
  if (nid === "30" || /ksampler|minimax|sampler/.test(label)) return 2;
  if (nid === "12") return 1;
  if (pair && pair.max > 1 && pair.value > 0) return 1;
  return 0;
}

function pickProgressNode(data) {
  if (!data || typeof data !== "object") return null;
  const nodes = data.nodes && typeof data.nodes === "object" ? data.nodes : {};
  const cands = [];
  function consider(id, obj, running) {
    const pair = readProgressPair(obj);
    if (!pair) return;
    const ratio = pairRatio(pair);
    cands.push({
      id: id || "",
      pair,
      ratio: ratio != null && ratio > 0 ? ratio : null,
      running: !!running,
      boost: nodeSamplerBoost(id, pair),
    });
  }
  if (readProgressPair(data)) consider(data.node || "", data, true);
  Object.keys(nodes).forEach((id) => {
    const n = nodes[id] || {};
    const st = String(n.state || "").toLowerCase();
    if (st === "finished" || st === "pending" || st === "error") return;
    consider(id, n, st === "running" || st === "executing");
  });
  const stepped = cands.filter((c) => c.pair && c.pair.max > 1 && c.pair.value >= 1 && c.ratio != null);
  const useful = stepped.length ? stepped : cands.filter((c) => c.ratio != null);
  const pool = useful.length ? useful : [];
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const sa = (a.pair && a.pair.max > 1) ? 1 : 0;
    const sb = (b.pair && b.pair.max > 1) ? 1 : 0;
    if (sb !== sa) return sb - sa;
    if ((b.boost || 0) !== (a.boost || 0)) return (b.boost || 0) - (a.boost || 0);
    const ra = a.ratio == null ? -1 : a.ratio;
    const rb = b.ratio == null ? -1 : b.ratio;
    return rb - ra;
  });
  return pool[0];
}

function applySamplerProgress(value, max, nodeId) {
  const pair = readProgressPair({ value, max }) || (
    Number.isFinite(Number(value)) && Number.isFinite(Number(max)) && Number(max) > 1 && Number(value) >= 1
      ? { value: Number(value), max: Number(max) }
      : null
  );
  if (!pair) return;
  const pct = pairDisplayPct(pair);
  const stepped = pair.max > 1 && pair.value >= 1;
  if (pct == null) {
    if ((state.lastPct || 0) > 0) {
      setProgress(state.lastPct, queueNote(nodePhaseNote(nodeId)));
    }
    return;
  }
  if (!stepped && pct >= 99.5 && (state.lastPct || 0) < 2 && pair.max === 1) {
    setProgress(state.lastPct || 0, queueNote(nodePhaseNote(nodeId)));
    return;
  }
  if (!stepped && pct + 0.5 < (state.lastPct || 0) && pct < 2) {
    setProgress(state.lastPct, queueNote("generating…"));
    return;
  }
  if (!stepped && pct + 0.5 < (state.lastPct || 0) && pair.value < pair.max) return;
  if (stepped) state.progressPhase = "sample";
  clearTimeout(state.h3Hint);
  applySamplerProgress._label = stepped
    ? Math.round(pair.value) + "/" + Math.round(pair.max)
    : Math.round(pct) + "%";
  applySamplerProgress._key = String(nodeId || "") + ":" + Math.round(pair.max);
  setProgress(pct, queueNote(stepped ? "step " + applySamplerProgress._label : "generating…"));
}

function applyProgressState(data) {
  const pick = pickProgressNode(data);
  if (pick) applySamplerProgress(pick.pair.value, pick.pair.max, pick.id);
}

function startProgressPoll() {
  if (startProgressPoll._t) return;
  startProgressPoll._t = setInterval(async () => {
    if (!state.running) {
      stopProgressPoll();
      return;
    }
    try {
      const j = await apiFetch("/api/progress");
      if (!j || !state.running) return;
      const stepped = Number(j.max) > 1 && Number(j.value) >= 1;
      if (j.prompt_id && !state.promptId) state.promptId = j.prompt_id;
      if (stepped) applySamplerProgress(j.value, j.max, j.node);
      else if (Number.isFinite(Number(j.pct)) && Number(j.pct) > (state.lastPct || 0)) {
        setProgress(j.pct, queueNote(j.note || "generating…"));
      }
    } catch (_) {}
    if (state.running && state.wantConnect && (!state.ws || state.ws.readyState > 1)) openSocket();
  }, 750);
}

function stopProgressPoll() {
  if (startProgressPoll._t) {
    clearInterval(startProgressPoll._t);
    startProgressPoll._t = null;
  }
}

function startRun(opts) {
  opts = opts || {};
  state.running = true;
  state.failPid = null;
  updateQueueUi();
  startProgressPoll();
  if (state.wantConnect && state.online && (!state.ws || state.ws.readyState > 1)) openSocket();
  const h3 = state.jobFamily === "h3" || (state.pack && state.pack.family === "h3");
  const resumePct = opts.resume ? (Number(state.lastPct) || 0) : 0;
  if (!opts.resume) {
    progressStore.pct = 0;
    progressStore.note = "";
    state.lastPct = 0;
    state.progressPhase = "load";
    applySamplerProgress._key = "";
  }
  if (resumePct > 0) {
    setProgress(resumePct, queueNote("still generating…"));
  } else {
    setProgress(0, queueNote(h3 ? "H3 first step loads ~20GB — 0% is normal…" : "loading models…"));
  }
  clearTimeout(state.h3Hint);
  if (h3 && resumePct <= 0) {
    state.h3Hint = setTimeout(() => {
      if (!state.running) return;
      if ((state.lastPct || 0) > 0 || state.progressPhase !== "load") {
        setProgress(state.lastPct || 0, queueNote("still generating…"));
        return;
      }
      setProgress(0, queueNote("still paging H3 into 8GB VRAM — leave it running"));
    }, 25000);
  }
}
function finishRun() {
  state.running = false;
  state.submitting = false;
  state.stopping = false;
  state.promptId = null;
  state.currentJobKey = null;
  stopWatching();
  stopProgressPoll();
  clearTimeout(state.h3Hint);
  updateQueueUi();
  syncVeil();
  persistRun();
}
async function interrupt() {
  if (state.stopping) {
    toast("Still stopping — wait a moment.", true);
    return;
  }
  const oldPid = state.promptId;
  state.stopping = true;
  state.stoppedAt = Date.now();
  if (oldPid) {
    state.donePids[oldPid] = 1;
    state.failPid = oldPid;
  }
  state.queue = [];
  clearPendingPlaceholders();
  if (state.film) {
    state.film.runAll = false;
    state.film.runIndex = -1;
    (state.film.clips || []).forEach((c) => {
      if (c.status === "running" || c.status === "queued") c.status = "idle";
    });
    persistFilm();
    renderFilmClips();
  }
  stopWatching();
  updateQueueUi();
  let ok = true;
  try {
    const j = await apiFetch("/api/interrupt", { method: "POST" });
    if (j && j.ok === false) ok = false;
  } catch (_) {
    ok = false;
  }
  const idle = await waitComfyIdle(6000);
  if (state.promptId === oldPid) state.promptId = null;
  finishRun();
  if (!ok) toast("Stop sent, but Comfy may still be busy. Wait or check 8188.", true);
  else if (!idle) toast("Stopped. Comfy is still winding down — wait a moment before Generate.", true);
  else toast("Stopped. Queue cleared.");
}

function closeSocket() {
  try {
    if (state.ws) state.ws.close();
  } catch (_) {}
  state.ws = null;
}

function openSocket() {
  try {
    if (state.ws) state.ws.close();
  } catch (_) {}
  const httpBase = state.apiBase || location.origin || "http://127.0.0.1:7860";
  if (!/^https?:/.test(httpBase)) return;
  const proto = httpBase.startsWith("https") ? "wss" : "ws";
  const host = httpBase.replace(/^https?:\/\//, "");
  const url = `${proto}://${host}/ws?clientId=${state.clientId}&comfy=${encodeURIComponent(comfy())}`;
  const ws = new WebSocket(url);
  state.ws = ws;
  ws.onclose = () => {
    if (state.ws === ws) state.ws = null;
    if (state.running && state.online && state.wantConnect) {
      clearTimeout(openSocket._retry);
      openSocket._retry = setTimeout(() => {
        if (state.running && (!state.ws || state.ws.readyState > 1)) openSocket();
      }, 1500);
    }
  };
  ws.onmessage = (ev) => {
    openSocket._alive = Date.now();
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type === "progress" && m.data) {
      const pair = readProgressPair(m.data);
      if (pair) applySamplerProgress(pair.value, pair.max, m.data.node);
      else if (Number.isFinite(Number(m.data.progress))) {
        const frac = Number(m.data.progress);
        if (frac >= 0 && frac <= 1) applySamplerProgress(frac, 1, m.data.node);
        else if (frac > 1 && frac <= 100) applySamplerProgress(frac, 100, m.data.node);
      }
    } else if (m.type === "progress_state" && m.data) {
      applyProgressState(m.data);
    } else if (m.type === "executing" && m.data) {
      if (m.data.node === null && m.data.prompt_id === state.promptId) {
        setProgress(100, queueNote("finishing…"));
        onFinished(state.promptId);
      } else if (state.running && m.data.node) {
        const nid = String(m.data.node);
        if (nid === "30" || nid === "12") state.progressPhase = "sample";
        else if (state.progressPhase === "load") state.progressPhase = "graph";
        setProgress(state.lastPct || 0, queueNote(nodePhaseNote(nid)));
      }
    } else if (m.type === "execution_error") {
      const d = m.data || {};
      const errPid = d.prompt_id || state.promptId;
      if (state.stopping) return;
      if (state.promptId && errPid && errPid !== state.promptId) return;
      state.failPid = errPid;
      toast(humanizeExecError(d), true);
      dropJobPlaceholder(errPid);
      kickQueue();
    } else if (m.type === "execution_interrupted") {
      const d = m.data || {};
      const pid = d.prompt_id || state.promptId;
      if (state.stopping) return;
      if (state.promptId && pid && pid !== state.promptId) return;
      dropJobPlaceholder(pid);
      kickQueue();
    } else if (m.type === "preview_bin" && m.data) {
      showLivePreview(m.data);
    } else if (m.type === "bridge_error") {
      toast("Progress bridge: " + m.data, true);
    }
  };
}

function humanizeExecError(d) {
  const msg = String((d && (d.exception_message || d.message)) || "");
  const low = msg.toLowerCase();
  if (low.includes("128 channels") || (low.includes("expected input") && low.includes("got 128"))) {
    return "Klein sampled, then decode failed: it needs flux2-vae.safetensors, not Flux.1 ae. Put that file in models/vae, refresh Models, retry.";
  }
  if (low.includes("out of memory") || low.includes("cudaerrormemoryallocation")) {
    return "Out of GPU memory (OOM). Restart ComfyUI, keep Video at 5 seconds, and retry. If it happens again, drop duration to 4s.";
  }
  if (low.includes("mat1 and mat2") || low.includes("cannot be multiplied")) {
    return "CLIP and UNet don't match. Klein needs Qwen3-4B with CLIP type flux2 — not Qwen 3.5.";
  }
  if (msg) return "ComfyUI error: " + msg.replace(/\s+/g, " ").slice(0, 220);
  return "ComfyUI execution error — check its console.";
}

function historyError(entry) {
  const st = entry && entry.status;
  if (!st) return "";
  if (st.status_str !== "error") return "";
  for (const m of st.messages || []) {
    const payload = Array.isArray(m) ? m[1] : m;
    if (payload && payload.exception_message) return humanizeExecError(payload);
  }
  return "ComfyUI reported an error and saved no image.";
}

function isVideoFile(name) {
  return /\.(mp4|webm|mov|mkv)$/i.test(name || "");
}
function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.indexOf("image/") === 0) return true;
  return /\.(png|jpe?g|webp|gif|bmp|tif{1,2})$/i.test(file.name || "");
}
function isVideoDropFile(file) {
  if (!file) return false;
  if (file.type && file.type.indexOf("video/") === 0) return true;
  return isVideoFile(file.name);
}
function wireDrop(el, onFiles, acceptDrag) {
  if (!el || el.dataset.yiDrop === "1") return;
  el.dataset.yiDrop = "1";
  let n = 0;
  el.addEventListener("dragenter", (e) => {
    if (acceptDrag && !acceptDrag()) return;
    e.preventDefault();
    n += 1;
    el.classList.add("drop-over");
  });
  el.addEventListener("dragover", (e) => {
    if (acceptDrag && !acceptDrag()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  el.addEventListener("dragleave", () => {
    n = Math.max(0, n - 1);
    if (!n) el.classList.remove("drop-over");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    n = 0;
    el.classList.remove("drop-over");
    if (acceptDrag && !acceptDrag()) return;
    const files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length) onFiles(files, e);
  });
}

function collectMedia(entry) {
  const media = [];
  const outs = (entry && entry.outputs) || {};
  const push = (arr, kind, animated) => (arr || []).forEach((im) => {
    if (!im || !im.filename) return;
    const vid = kind === "video" || animated || isVideoFile(im.filename);
    media.push({ ...im, kind: vid ? "video" : (kind || "image") });
  });
  for (const nid in outs) {
    const o = outs[nid] || {};
    const animated = o.animated === true || (Array.isArray(o.animated) && o.animated[0]);
    push(o.images, "image", animated);
    push(o.gifs, "video");
    push(o.videos, "video");
    push(o.files, null, animated);
  }
  return media;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shutdownImagine() {
  if (!window.confirm("Shut down Your Imagination and ComfyUI, and close both console windows?")) return;
  toast("Shutting down…");
  try {
    await apiFetch("/api/shutdown", { method: "POST" });
  } catch (_) {}
  document.body.innerHTML = (
    '<div style="min-height:100vh;display:grid;place-items:center;background:#000;color:#9a9a9d;' +
    'font-family:system-ui,sans-serif;text-align:center;padding:32px">' +
    '<div><div style="color:#f5f5f5;font-size:22px;font-weight:650;margin-bottom:10px">' +
    "Your Imagination is shutting down</div>" +
    "<div>ComfyUI and this app are stopping. You can close this tab.</div></div></div>"
  );
}

async function restartImagine() {
  if (state.running || state.submitting || (state.queue || []).length) {
    toast("A job is running. Wait for it to finish, then restart.", true);
    return;
  }
  try {
    const q = await apiFetch("/api/queue");
    if (comfyQueueBusy(q)) {
      toast("ComfyUI is busy. Wait for the queue to finish, then restart.", true);
      return;
    }
  } catch (_) {}
  $("#gear").classList.remove("on");
  toast("Restarting Your Imagination…");
  sessionStorage.setItem("imagine-restarting", "1");
  try {
    await apiFetch("/api/restart", { method: "POST" });
  } catch (_) {}
  const bases = apiBases();
  for (let i = 0; i < 50; i++) {
    await sleep(400);
    for (const base of bases) {
      try {
        const r = await fetch(base + "/api/health", { cache: "no-store" });
        if (r.ok) {
          location.reload();
          return;
        }
      } catch (_) {}
    }
  }
  sessionStorage.removeItem("imagine-restarting");
  toast("Your Imagination did not come back. Run start-windows.bat.", true);
}

async function onFinished(pid, opts) {
  opts = opts || {};
  if (state.stopping) return;
  if (state.failPid === pid) return;
  if (state.promptId && pid && state.promptId !== pid) return;
  if (state.donePids[pid]) {
    if (!opts.skipKick) await kickQueue();
    return;
  }
  state.donePids[pid] = 1;
  let gotMedia = false;
  try {
    const tries = opts.quick ? 1 : 10;
    for (let i = 0; i < tries; i++) {
      const h = await apiFetch("/api/history/" + pid);
      const entry = h && (h[pid] || (h.history && h.history[pid]));
      if (entry) {
        const err = historyError(entry);
        if (err) {
          toast(err, true);
          break;
        }
        const media = collectMedia(entry);
        if (media.length) {
          media.forEach(addResult);
          gotMedia = true;
          dropJobPlaceholder(pid);
          if (state.film && (state.film.runAll || (state.lastJob && state.lastJob.film_clip))) {
            await filmAfterClip(pickFilmMedia(media));
            return;
          }
          break;
        }
      }
      if (i + 1 < tries) await sleep(400);
    }
  } catch {
    toast("Finished, but could not read history.", true);
  }
  if (!gotMedia) dropJobPlaceholder(pid);
  if (!opts.skipKick) await kickQueue();
}

function addResult(m) {
  const kind = isVideoFile(m.filename) ? "video" : (m.kind || "image");
  const elapsed = state.jobStartedAt ? Math.max(0, Date.now() - state.jobStartedAt) : 0;
  const ts = Date.now();
  const it = {
    url: viewUrl({ ...m, ts, prompt_id: state.promptId || m.prompt_id || "" }),
    kind,
    prompt: state.currentPrompt || ($("#idea") && $("#idea").value) || "",
    pack: state.jobPackId || (state.pack && state.pack.id),
    pack_title: state.jobPackTitle || (state.pack && state.pack.title),
    ts,
    elapsed_ms: elapsed,
    pct: Number(state.lastPct) || 0,
    prompt_id: state.promptId || m.prompt_id || "",
    filename: m.filename,
    subfolder: m.subfolder || "",
    type: m.type || "output",
    exists: true,
    pending: false,
    status: "done",
    neg: (state.lastJob && state.lastJob.neg) || currentNeg(),
    settings: Object.assign({}, state.lastJob || snapshotSettings(), { pct: Number(state.lastPct) || 0 }),
  };
  const hist = state.history || [];
  let idx = hist.findIndex((x) => isPendingItem(x) && (
    (it.prompt_id && x.prompt_id && String(x.prompt_id) === String(it.prompt_id))
    || (state.currentJobKey && x.job_key === state.currentJobKey)
    || (it.job_key && x.job_key && x.job_key === it.job_key)
  ));
  if (idx < 0) {
    const running = hist.filter((x) => isPendingItem(x) && x.status === "running");
    if (running.length === 1) idx = hist.indexOf(running[0]);
  }
  const dropPending = (x) => {
    if (!isPendingItem(x)) return false;
    if (it.prompt_id && x.prompt_id && String(x.prompt_id) === String(it.prompt_id)) return true;
    if (it.job_key && x.job_key && x.job_key === it.job_key) return true;
    if (state.currentJobKey && x.job_key === state.currentJobKey) return true;
    return false;
  };
  if (idx >= 0) {
    it.job_key = hist[idx].job_key;
    hist[idx] = it;
    state.history = hist.filter((x, i) => i === idx || (!sameMedia(x, it) && !dropPending(x)));
  } else {
    state.history = [it].concat(hist.filter((x) => !sameMedia(x, it) && !dropPending(x)));
  }
  showInCanvas(it);
  renderHistory();
  persistFeed();
  apiFetch("/api/library/remember", { method: "POST", body: JSON.stringify(it) }).catch(() => {});
}
function sameMedia(a, b) {
  if (!a || !b) return false;
  if (a.job_key && b.job_key && a.job_key === b.job_key) return true;
  const pidA = a.prompt_id || "";
  const pidB = b.prompt_id || "";
  if (pidA && pidB) {
    return pidA === pidB
      && (a.filename || "") === (b.filename || "")
      && (a.subfolder || "") === (b.subfolder || "")
      && (a.type || "output") === (b.type || "output");
  }
  if (pidA || pidB) return false;
  const tsA = Number(a.ts) || 0;
  const tsB = Number(b.ts) || 0;
  if (tsA && tsB && tsA !== tsB) return false;
  return (a.filename || "") === (b.filename || "")
    && (a.subfolder || "") === (b.subfolder || "")
    && (a.type || "output") === (b.type || "output");
}
function mediaFromLib(it) {
  return {
    url: viewUrl(it),
    kind: it.kind || (isVideoFile(it.filename) ? "video" : "image"),
    prompt: it.prompt || "",
    pack: it.pack || "",
    pack_title: it.pack_title || "",
    ts: it.ts || it.mtime || Date.now(),
    elapsed_ms: it.elapsed_ms || 0,
    pct: it.pct || (it.settings && it.settings.pct) || 0,
    prompt_id: it.prompt_id || "",
    filename: it.filename,
    subfolder: it.subfolder || "",
    type: it.type || "output",
    exists: it.exists !== false,
    source: it.source || (it.type === "input" ? "uploaded" : "generated"),
    neg: it.neg || "",
    settings: it.settings || null,
  };
}
async function loadLibrary() {
  try {
    const j = await apiFetch("/api/library");
    state.gallery = (j.gallery || []).map(mediaFromLib);
    state.libHistory = (j.history || []).map(mediaFromLib);
    state.inputRoot = j.input_root || "";
    state.outputRoot = j.output_root || "";
    const live = state.libHistory.filter((x) => x.exists !== false && x.filename);
    const keys = new Set(live.map((x) => (x.type || "output") + "/" + (x.subfolder || "") + "/" + x.filename));
    (state.gallery || []).forEach((it) => {
      const k = (it.type || "output") + "/" + (it.subfolder || "") + "/" + it.filename;
      if (it.filename && it.exists !== false) keys.add(k);
    });
    const pending = (state.history || []).filter((x) => {
      if (!isPendingItem(x)) return false;
      if (pendingMatchesOutput(x, live)) return false;
      if (!state.resumeChecked) return true;
      return keepPendingItem(x, live);
    });
    const extras = (state.history || []).filter((x) => {
      if (!x || isPendingItem(x) || !x.filename || x.exists === false) return false;
      const age = Date.now() - (Number(x.ts) || 0);
      return age < 180000 && !live.some((y) => sameMedia(x, y));
    });
    state.history = pending.concat(extras.concat(live));
    persistFeed();
    if (state.shown && isPendingItem(state.shown) && !pending.some((x) => x === state.shown || (x.job_key && x.job_key === state.shown.job_key))) {
      state.shown = null;
      const home = $("#placeholder");
      if (home) home.style.display = "";
      clearFrameMedia();
      renderStageActions();
      syncVeil();
    }
    if (state.shown && state.shown.filename && !isPendingItem(state.shown)) {
      const k = (state.shown.type || "output") + "/" + (state.shown.subfolder || "") + "/" + state.shown.filename;
      if (!keys.has(k)) {
        state.shown = null;
        const ph = $("#placeholder");
        if (ph) ph.style.display = "";
        clearFrameMedia();
        renderStageActions();
        syncVeil();
      }
    }
    renderHistory();
    renderLibrary();
  } catch (e) {
    console.error(e);
  }
}
function openLibrary() {
  $("#overlay").classList.add("on");
  $("#libSheet").classList.add("on");
  setLibTab(state.libTab || "gallery");
  loadLibrary();
}
function closeLibrary() {
  const el = $("#libSheet");
  if (el) el.classList.remove("on");
}
function setLibTab(tab) {
  state.libTab = tab === "history" ? "history" : "gallery";
  const gal = $("#galGrid");
  const hist = $("#histList");
  if (gal) gal.hidden = state.libTab !== "gallery";
  if (hist) hist.hidden = state.libTab !== "history";
  const seg = $("#libSeg");
  if (seg) [...seg.querySelectorAll("button")].forEach((b) => b.classList.toggle("on", b.dataset.lib === state.libTab));
  renderLibrary();
}
function fmtWhen(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch (_) {
    return "";
  }
}
function fmtElapsed(ms) {
  ms = Number(ms);
  if (!Number.isFinite(ms) || ms < 1000) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? m + "m " + r + "s" : m + "m";
  const h = Math.floor(m / 60);
  return (m % 60) ? h + "h " + (m % 60) + "m" : h + "h";
}
function fmtAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - Number(ts)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 7) return Math.floor(s / 86400) + "d ago";
  try {
    return new Date(ts).toLocaleDateString();
  } catch (_) {
    return "";
  }
}
function libMatches(it) {
  if (state.libKind === "video" && it.kind !== "video") return false;
  if (state.libKind === "image" && it.kind === "video") return false;
  const uploaded = (it.type === "input") || it.source === "uploaded";
  if (state.libSource === "generated" && uploaded) return false;
  if (state.libSource === "uploaded" && !uploaded) return false;
  const q = (state.libQuery || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [it.prompt, it.filename, it.pack, it.pack_title, it.subfolder].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}
function syncLibChrome(shown, total) {
  const blurb = $("#libBlurb");
  if (blurb) {
    const base = state.libTab === "history"
      ? "Gens from this app, with the prompt. Kept even if you delete the file."
      : state.libSource === "uploaded"
        ? ("Photos in the media hub input folder" + (state.inputRoot ? " — " + state.inputRoot : "") + ". Drop files there, then Refresh.")
        : state.libSource === "generated"
          ? ("Files this app (and ComfyUI) wrote to the media hub output folder" + (state.outputRoot ? " — " + state.outputRoot : "") + ".")
          : "Generated stills in the media hub output folder, plus photos you drop into input.";
    blurb.textContent = total && shown !== total ? `${base} Showing ${shown} of ${total}.` : base;
  }
}
function copyLibPrompt(text) {
  const s = (text || "").trim();
  if (!s) {
    toast("No prompt saved for that one.", true);
    return;
  }
  navigator.clipboard.writeText(s).then(() => toast("Prompt copied.")).catch(() => toast("Could not copy.", true));
}
function openLibItem(it) {
  if (it.exists === false) {
    if (it.prompt) $("#idea").value = it.prompt;
    toast("File is gone. Prompt put back in the box.", true);
    return;
  }
  showInCanvas(it);
  closeLibrary();
  $("#overlay").classList.remove("on");
}
function libPool() {
  if (state.libTab !== "history") return state.gallery || [];
  const hist = state.libHistory || [];
  const seen = new Set(hist.map((x) => (x.type || "output") + "/" + (x.subfolder || "") + "/" + x.filename));
  const extras = (state.gallery || []).filter((x) => {
    const k = (x.type || "output") + "/" + (x.subfolder || "") + "/" + x.filename;
    return x.type === "input" && !seen.has(k);
  });
  return hist.concat(extras);
}
function renderLibrary() {
  const gal = $("#galGrid");
  const hist = $("#histList");
  const source = libPool();
  const items = source.filter(libMatches);
  syncLibChrome(items.length, source.length);
  if (gal && state.libTab === "gallery") {
    if (!source.length) {
      gal.innerHTML = `<div class="lib-empty"><b>Gallery is empty</b>Nothing in the media hub output folder yet. Generate something first.</div>`;
    } else if (!items.length) {
      gal.innerHTML = `<div class="lib-empty"><b>No matches</b>Try a different search or filter.</div>`;
    } else {
      gal.innerHTML = "";
      items.forEach((it) => gal.appendChild(galleryCell(it)));
    }
  }
  if (hist && state.libTab === "history") {
    if (!source.length) {
      hist.innerHTML = `<div class="lib-empty"><b>No history yet</b>Gens you make here show up with the prompt, model, and time.</div>`;
    } else if (!items.length) {
      hist.innerHTML = `<div class="lib-empty"><b>No matches</b>Try a different search or filter.</div>`;
    } else {
      hist.innerHTML = "";
      items.forEach((it) => hist.appendChild(historyRow(it)));
    }
  }
}
function galleryCell(it) {
  const cell = document.createElement("div");
  cell.className = "gcell";
  cell.title = it.prompt || it.filename || "";
  const media = it.kind === "video" ? document.createElement("video") : document.createElement("img");
  media.src = it.url;
  if (it.kind === "video") {
    media.muted = true;
    media.loop = true;
    media.playsInline = true;
    media.preload = "metadata";
    cell.addEventListener("mouseenter", () => media.play().catch(() => {}));
    cell.addEventListener("mouseleave", () => { media.pause(); });
  } else {
    media.addEventListener("error", () => {
      cell.classList.add("broke");
      media.replaceWith(Object.assign(document.createElement("div"), { textContent: it.filename || "file" }));
    }, { once: true });
  }
  if (it.kind === "video") {
    const kind = document.createElement("div");
    kind.className = "kind";
    kind.textContent = "Video";
    cell.appendChild(kind);
  } else if (it.type === "input") {
    const kind = document.createElement("div");
    kind.className = "kind";
    kind.textContent = "Upload";
    cell.appendChild(kind);
  }
  const cap = document.createElement("div");
  cap.className = "cap";
  const p = document.createElement("div");
  p.className = "p";
  p.textContent = it.prompt || it.filename || "";
  const m = document.createElement("div");
  m.className = "m";
  m.textContent = [
    it.type === "input" ? "Uploaded" : (it.pack_title || it.pack || "Generated"),
    fmtAgo(it.ts),
  ].filter(Boolean).join(" · ");
  cap.append(p, m);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "del";
  del.title = "Delete from disk";
  del.textContent = "×";
  del.onclick = (e) => {
    e.stopPropagation();
    deleteMedia(it);
  };
  cell.append(media, cap, del);
  if (it.kind !== "video") {
    const use = document.createElement("button");
    use.type = "button";
    use.className = "use";
    use.title = "Use for edit";
    use.textContent = "Edit";
    use.onclick = (e) => {
      e.stopPropagation();
      attachResult(it, { animate: false });
      closeLibrary();
      $("#overlay").classList.remove("on");
    };
    cell.appendChild(use);
  }
  cell.onclick = () => openLibItem(it);
  return cell;
}
function historyRow(it) {
  const row = document.createElement("div");
  row.className = "hist-row";
  let thumb;
  if (it.exists === false) {
    thumb = document.createElement("div");
    thumb.className = "ph";
    thumb.textContent = "File gone";
  } else {
    thumb = it.kind === "video" ? document.createElement("video") : document.createElement("img");
    thumb.src = it.url;
    if (it.kind === "video") {
      thumb.muted = true;
      thumb.preload = "metadata";
    }
  }
  const body = document.createElement("div");
  const t = document.createElement("div");
  t.className = "t";
  t.textContent = it.prompt || it.filename || "Untitled";
  const st = document.createElement("div");
  st.className = "st" + (it.exists === false ? " gone" : "");
  const pack = it.pack_title || it.pack || "";
  const took = fmtElapsed(it.elapsed_ms);
  st.textContent = [
    it.exists === false ? "File deleted" : (it.kind === "video" ? "Video" : "Image"),
    pack,
    took ? "took " + took : "",
    fmtAgo(it.ts) || fmtWhen(it.ts),
  ].filter(Boolean).join(" · ");
  body.append(t, st);
  const acts = document.createElement("div");
  acts.className = "acts";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "ghost";
  copy.textContent = "Copy";
  copy.title = "Copy prompt";
  copy.onclick = (e) => {
    e.stopPropagation();
    copyLibPrompt(it.prompt);
  };
  if (it.settings || it.prompt) {
    const use = document.createElement("button");
    use.type = "button";
    use.className = "ghost";
    use.textContent = "Use settings";
    use.title = "Load this prompt and sampler settings";
    use.onclick = (e) => {
      e.stopPropagation();
      applySettings(it.settings || { prompt: it.prompt, pack: it.pack, neg: it.neg }, it.kind !== "video" ? { asInit: true, item: it } : {});
      closeLibrary();
      $("#overlay").classList.remove("on");
    };
    acts.appendChild(use);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "ghost";
  del.textContent = "Delete";
  del.onclick = (e) => {
    e.stopPropagation();
    deleteMedia(it);
  };
  acts.append(copy, del);
  row.append(thumb, body, acts);
  row.onclick = () => openLibItem(it);
  return row;
}
async function deleteMedia(it) {
  if (!it) return;
  if (isPendingItem(it)) {
    if (it.status === "running") {
      toast("Stop the job to remove this one.", true);
      return;
    }
    state.queue = (state.queue || []).filter((p) => !p || p._job_key !== it.job_key);
    state.history = (state.history || []).filter((x) => !sameMedia(x, it) && x.job_key !== it.job_key);
    persistFeed();
    updateQueueUi();
    renderHistory();
    if (state.shown && (sameMedia(state.shown, it) || state.shown.job_key === it.job_key)) {
      const next = state.history[0];
      if (next) showInCanvas(next);
      else showHomeStage();
    }
    return;
  }
  if (!it.filename) return;
  const msg = it.exists === false
    ? "Remove this prompt from history?"
    : "Delete this file from the output folder?";
  if (!window.confirm(msg)) return;
  try {
    await apiFetch("/api/library/delete", {
      method: "POST",
      body: JSON.stringify({
        filename: it.filename,
        subfolder: it.subfolder || "",
        type: it.type || "output",
      }),
    });
    state.history = (state.history || []).filter((x) => !sameMedia(x, it));
    state.libHistory = (state.libHistory || []).filter((x) => !sameMedia(x, it));
    persistFeed();
    renderHistory();
    if (state.shown && sameMedia(state.shown, it)) {
      state.shown = null;
      $("#placeholder").style.display = "";
      clearFrameMedia();
      renderStageActions();
    }
    toast(it.exists === false ? "Removed from history." : "Deleted from the output folder.");
    await loadLibrary();
  } catch (e) {
    toast(e.message || "Could not delete that file.", true);
  }
}
function muteLabel() {
  return state.muted ? "🔇" : "🔊";
}
function syncMuteUi() {
  const b = $("#muteBtn");
  if (!b) return;
  b.textContent = muteLabel();
  b.title = state.muted ? "Unmute" : "Mute";
  b.classList.toggle("muted", state.muted);
}
function setMuted(on) {
  state.muted = !!on;
  try { localStorage.setItem("imagine-muted", state.muted ? "1" : "0"); } catch (_) {}
  const v = $("#frame video");
  if (v) {
    v.muted = state.muted;
    if (!state.muted) {
      v.volume = 1;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    }
  }
  syncMuteUi();
}
function toggleMute() {
  setMuted(!state.muted);
}
function formatMediaTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}
function videoDuration(v) {
  const d = v && v.duration;
  if (!Number.isFinite(d) || d <= 0) return 0;
  return d;
}
function makeVideoSeek(video) {
  const bar = document.createElement("div");
  bar.className = "video-seek";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Seek");
  const cur = document.createElement("span");
  cur.className = "video-seek-t";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1000";
  slider.value = "0";
  slider.step = "1";
  slider.setAttribute("aria-label", "Video position");
  const durEl = document.createElement("span");
  durEl.className = "video-seek-t";
  bar.append(cur, slider, durEl);

  let scrubbing = false;
  const paint = () => {
    const dur = videoDuration(video);
    const t = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    cur.textContent = formatMediaTime(t);
    durEl.textContent = formatMediaTime(dur);
    if (!scrubbing && dur > 0) slider.value = String(Math.round((t / dur) * 1000));
    else if (!dur) slider.value = "0";
    slider.disabled = dur <= 0;
  };
  const seekFromSlider = () => {
    const dur = videoDuration(video);
    if (dur <= 0) return;
    video.currentTime = (Number(slider.value) / 1000) * dur;
    cur.textContent = formatMediaTime(video.currentTime);
  };
  const stop = (e) => e.stopPropagation();
  bar.addEventListener("click", stop);
  bar.addEventListener("pointerdown", stop);
  slider.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    scrubbing = true;
    const end = () => {
      scrubbing = false;
      paint();
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  slider.addEventListener("input", seekFromSlider);
  slider.addEventListener("change", () => {
    scrubbing = false;
    seekFromSlider();
  });
  video.addEventListener("timeupdate", paint);
  video.addEventListener("durationchange", paint);
  video.addEventListener("loadedmetadata", paint);
  video.addEventListener("seeked", paint);
  paint();
  return bar;
}
function lockStageMediaRatio(el) {
  if (!el) return;
  const apply = () => {
    const w = el.videoWidth || el.naturalWidth;
    const h = el.videoHeight || el.naturalHeight;
    if (!w || !h) return;
    el.style.aspectRatio = w + " / " + h;
  };
  apply();
  el.addEventListener("loadedmetadata", apply);
  if (el.tagName === "IMG") el.addEventListener("load", apply);
}
function showInCanvas(it) {
  if (!it) return;
  state.shown = it;
  persistFeed();
  fillPromptBar(it);
  if (!isCurrentJobItem(it)) hideLivePreview();
  const home = $("#placeholder");
  if (home) home.style.display = "none";
  clearFrameMedia();
  const veil = $("#veil");
  if (isPendingItem(it)) {
    const node = document.createElement("div");
    node.className = "stage-pending";
    const pct = document.createElement("div");
    pct.className = "stage-pending-pct";
    pct.id = "stagePendingPct";
    const running = isCurrentJobItem(it);
    pct.textContent = running ? (liveProgressPct() + "%") : "…";
    const lab = document.createElement("div");
    lab.className = "stage-pending-lab";
    lab.textContent = running ? "Generating…" : "Queued";
    node.append(pct, lab);
    $("#frame").insertBefore(node, veil || null);
  } else if (it.kind === "video") {
    const wrap = document.createElement("div");
    wrap.className = "stage-player";
    const node = document.createElement("video");
    node.src = it.url;
    node.controls = false;
    node.autoplay = true;
    node.loop = true;
    node.muted = true;
    node.playsInline = true;
    node.preload = "auto";
    node.volume = 1;
    node.addEventListener("click", (e) => {
      e.preventDefault();
      if (node.paused) node.play().catch(() => {});
      else node.pause();
    });
    node.addEventListener("loadeddata", () => {
      if (state.muted) {
        node.play().catch(() => {});
      } else {
        node.muted = false;
        const p = node.play();
        if (p && p.catch) p.catch(() => { node.muted = true; node.play().catch(() => {}); });
      }
    }, { once: true });
    node.addEventListener("volumechange", () => {
      if (node.muted !== state.muted) setMuted(node.muted);
    });
    lockStageMediaRatio(node);
    primeVideoThumb(node);
    wrap.append(node, makeVideoSeek(node));
    $("#frame").insertBefore(wrap, veil || null);
  } else if (it.url) {
    const node = document.createElement("img");
    node.src = it.url;
    lockStageMediaRatio(node);
    $("#frame").insertBefore(node, veil || null);
  }
  syncMuteUi();
  renderStageActions();
  syncStageNav();
  syncVeil();
  syncStrip(it);
}
function renderStageActions() {
  const bar = $("#stageActions");
  if (!bar) return;
  const still = state.shown && !isPendingItem(state.shown) && state.shown.kind !== "video";
  const running = !!(state.running || state.queue.length);
  bar.classList.toggle("show", !!still && !running);
  const useStill = $("#useStill");
  const animateStill = $("#animateStill");
  if (useStill) useStill.hidden = !still || running;
  if (animateStill) animateStill.hidden = !still || running;
}
function historyMedia() {
  return (state.history || []).filter((it) => {
    if (!it) return false;
    if (isPendingItem(it)) return true;
    return it.filename && it.exists !== false && it.url;
  });
}
function historyIndex() {
  const list = historyMedia();
  const shown = state.shown;
  if (!shown) return -1;
  return list.findIndex((it) => sameMedia(it, shown));
}
function showHistoryOffset(dir) {
  const list = historyMedia();
  if (!list.length) {
    syncStageNav();
    if (state.film && state.film.view) toast("Nothing in history yet.");
    return;
  }
  if (list.length < 2) {
    syncStageNav();
    return;
  }
  let i = historyIndex();
  if (i < 0) i = dir > 0 ? -1 : 0;
  i = (i + dir + list.length) % list.length;
  const it = list[i];
  showInCanvas(it);
}
function syncStageNav() {
  const n = historyMedia().length;
  const stage = document.getElementById("stage");
  if (stage) stage.classList.toggle("has-hist", n > 1);
  const prev = document.getElementById("histPrev");
  const next = document.getElementById("histNext");
  if (prev) prev.hidden = n < 2;
  if (next) next.hidden = n < 2;
}
function typingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!el.isContentEditable;
}
function bindHistoryNav() {
  const prev = document.getElementById("histPrev");
  const next = document.getElementById("histNext");
  if (prev) {
    prev.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showHistoryOffset(-1);
    };
  }
  if (next) {
    next.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showHistoryOffset(1);
    };
  }
  if (!bindHistoryNav._keys) {
    bindHistoryNav._keys = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (typingInField()) return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      showHistoryOffset(e.key === "ArrowRight" ? 1 : -1);
    });
  }
  syncStageNav();
}
function bindStripScroll() {
  const strip = $("#strip");
  if (!strip || bindStripScroll._on) return;
  bindStripScroll._on = true;
  strip.addEventListener("wheel", (e) => {
    if (strip.scrollHeight <= strip.clientHeight) return;
    const dy = e.deltaY;
    const dx = e.deltaX;
    if (Math.abs(dx) > Math.abs(dy)) return;
    strip.scrollTop += dy;
    e.preventDefault();
  }, { passive: false });
}
function syncStrip(it) {
  const strip = $("#strip");
  if (!strip || typeof renderHistory !== "function") return;
  const list = historyMedia();
  const dom = [...strip.querySelectorAll(".item")];
  const stale = !dom.length
    || dom.length !== list.length
    || list.some((item, i) => (dom[i] && dom[i].getAttribute("data-media")) !== mediaStripKey(item));
  if (stale) {
    renderHistory();
    return;
  }
  dom.forEach((el, i) => {
    el.classList.toggle("active", !!(list[i] && it && sameMedia(list[i], it)));
  });
}

function renderHistory() {
  const strip = $("#strip");
  if (!strip) return;
  strip.innerHTML = "";
  historyMedia().forEach((it) => {
    const cell = document.createElement("div");
    const shown = state.shown;
    const pending = isPendingItem(it);
    const running = pending && isCurrentJobItem(it);
    cell.className = "item"
      + (shown && sameMedia(shown, it) ? " active" : "")
      + (pending ? " pending" : "")
      + (running ? " running" : "")
      + (pending && it.status === "queued" ? " queued" : "");
    if (it.job_key) cell.setAttribute("data-job-key", it.job_key);
    cell.setAttribute("data-media", mediaStripKey(it));
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (pending) {
      const mark = document.createElement("span");
      mark.className = "pending-pct";
      mark.textContent = running
        ? ((isCurrentJobItem(it) ? liveProgressPct() : (Number(it.pct) || 0)) + "%")
        : "…";
      thumb.appendChild(mark);
    } else {
      let media;
      if (it.kind === "video") {
        media = document.createElement("video");
        media.src = it.url;
        media.muted = true;
        media.loop = true;
        media.autoplay = true;
        media.playsInline = true;
        media.preload = "metadata";
        primeVideoThumb(media);
      } else {
        media = document.createElement("img");
        media.src = it.url;
      }
      media.onerror = () => {
        it.exists = false;
        state.history = (state.history || []).filter((x) => x.exists !== false || isPendingItem(x));
        persistFeed();
        cell.remove();
      };
      thumb.appendChild(media);
    }
    cell.append(thumb);
    if (!pending || it.status === "queued") {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.title = pending ? "Remove from queue" : "Delete from disk";
      del.textContent = "×";
      del.onclick = (e) => {
        e.stopPropagation();
        deleteMedia(it);
      };
      cell.append(del);
    }
    cell.onclick = () => {
      showInCanvas(it);
    };
    cell.ondblclick = () => {
      if (!pending && it.kind !== "video") attachResult(it, { animate: false });
    };
    strip.appendChild(cell);
  });
  syncStageNav();
}

async function uploadInit(file) {
  const fd = new FormData();
  fd.append("image", file, file.name);
  const j = await apiFetch("/api/upload", { method: "POST", body: fd });
  if (!j.ok) throw new Error(j.error);
  return j.name;
}
async function attachResult(it, opts) {
  opts = opts || {};
  if (!it || it.kind === "video") {
    toast("Pick a still first.", true);
    return;
  }
  try {
    toast(opts.animate ? "Attaching still for video…" : "Sending this still to Edit…");
    if ((it.type || "output") === "input") {
      const name = [it.subfolder, it.filename].filter(Boolean).join("/").replace(/\\/g, "/");
      state.initName = name;
      state.initUrl = it.url;
      showInit(it.url);
      capMPFromUrl(it.url);
    } else {
      const r = await fetch(it.url);
      if (!r.ok) throw new Error("Could not read the still");
      const blob = await r.blob();
      const base = (it.filename || "imagine.png").split(/[/\\]/).pop();
      const file = new File([blob], base, { type: blob.type || "image/png" });
      state.initName = await uploadInit(file);
      state.initUrl = it.url;
      showInit(it.url);
      capMPFromUrl(it.url);
    }
    if (opts.animate) {
      setUiMode("video");
      pickDefault();
      toast("Attached. Describe the motion, then send.");
    } else {
      setUiMode("edit");
      toast("Attached for edit.");
    }
  } catch (e) {
    toast("Could not attach still: " + (e && e.message ? e.message : e), true);
  }
}
function rememberInitSize(url) {
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    state.initW = img.naturalWidth || 0;
    state.initH = img.naturalHeight || 0;
    if (state.aspect === "auto") {
      syncAspectUi();
      syncSizeReadout();
    }
    if (state.uiMode === "video") return;
    const mp = (state.initW * state.initH) / 1e6;
    if (mp >= 0.2 && currentMP() > mp + 0.02) {
      setMegapixels(Math.round(Math.max(0.5, mp) * 100) / 100);
    }
  };
  img.src = url;
}
function capMPFromUrl(url) {
  rememberInitSize(url);
}
function showInit(url) {
  const box = $("#attach");
  if (box) {
    box.classList.toggle("show", attachOn());
    box.classList.add("filled");
    let i = box.querySelector("img");
    if (!i) {
      i = document.createElement("img");
      box.insertBefore(i, box.firstChild);
    }
    i.src = url;
  }
  if (state.pack && state.pack.family === "h3") applyH3ModeSettings();
  showInCanvas({
    url,
    kind: "image",
    filename: state.initName || "upload",
    type: "input",
    prompt: "",
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showSetup(on) {
  const el = $("#setup");
  if (!el) return;
  el.classList.toggle("on", !!on);
}

async function connectComfy(opts) {
  opts = opts || {};
  try {
    const j = await apiFetch("/api/connect", {
      method: "POST",
      body: JSON.stringify({ url: comfy() }),
    });
    applySession(j);
    if (!j.ok) {
      if (!opts.quiet) toast(j.error || "ComfyUI did not answer.", true);
      return;
    }
    openSocket();
    if (!opts.quiet) toast("Connected to ComfyUI.");
    await scan({ quiet: true, skipSetup: true, skipConnect: true });
  } catch (e) {
    if (!opts.quiet) toast(e.message || "Connect failed.", true);
  }
}

async function disconnectComfy() {
  try {
    const j = await apiFetch("/api/disconnect", { method: "POST" });
    applySession(j);
    closeSocket();
    toast("Disconnected. Model manager still works.");
  } catch (e) {
    toast(e.message || "Disconnect failed.", true);
  }
}

async function toggleConnect() {
  if (state.wantConnect && state.online) return disconnectComfy();
  return connectComfy();
}

async function browseFolder(targetId, prefer) {
  try {
    const j = await apiFetch("/api/browse-folder", { method: "POST", body: "{}" });
    if (j.cancelled) return;
    const path = (prefer === "comfy" && (j.comfy_root || j.path))
      || j.models_root
      || j.path;
    const el = $(targetId);
    if (el && path) el.value = path;
    return path;
  } catch (e) {
    toast(e.message || "Could not open folder picker. Paste the path instead.", true);
  }
}

async function saveModelsFolder(raw, url) {
  const comfyRoot = ($("#setupComfyRoot") && $("#setupComfyRoot").value.trim())
    || ($("#settingsComfyRoot") && $("#settingsComfyRoot").value.trim())
    || state.comfyRoot
    || "";
  const j = await apiFetch("/api/setup", {
    method: "POST",
    body: JSON.stringify({
      models_root: raw,
      comfy_url: url || comfy(),
      comfy_root: comfyRoot,
      connected: state.wantConnect,
    }),
  });
  applySession(j);
  state.packs = j.packs || state.packs;
  state.loras = j.loras || state.loras;
  renderPacks();
  renderNew(j.new_files || []);
  pickDefault();
  showSetup(false);
  toast("Models folder set. " + (j.packs || []).filter((p) => p.ready).length + " pack(s) ready.");
  return j;
}

async function startDownload(packId, assetId) {
  try {
    const j = await apiFetch("/api/downloads", {
      method: "POST",
      body: JSON.stringify({ pack_id: packId, asset_id: assetId }),
    });
    const job = j.job || j.job;
    if (job && (job.already || job.already)) {
      toast("Already on disk.");
      return scan({ quiet: true, skipSetup: true });
    }
    state.jobs = j.jobs || [];
    renderPackDetail(packId);
    if ($("#inspector") && $("#inspector").classList.contains("on")) renderInspector();
    syncDlPoll();
    toast("Downloading…");
  } catch (e) {
    toast(e.message || "Download failed.", true);
  }
}

async function cancelDownload(id) {
  try {
    const j = await apiFetch("/api/downloads/cancel", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    state.jobs = j.jobs || [];
    if (state.viewPackId) renderPackDetail(state.viewPackId);
    if ($("#inspector") && $("#inspector").classList.contains("on")) renderInspector();
  } catch (e) {
    toast(e.message || "Could not cancel.", true);
  }
}

function syncDlPoll() {
  const busy = (state.jobs || []).some((j) => j.status === "queued" || j.status === "running" || j.status === "cancelling");
  if (!busy) {
    if (syncDlPoll._t) {
      clearInterval(syncDlPoll._t);
      syncDlPoll._t = null;
    }
    return;
  }
  if (syncDlPoll._t) return;
  syncDlPoll._t = setInterval(async () => {
    try {
      const j = await apiFetch("/api/downloads");
      const prev = state.jobs || [];
      state.jobs = j.jobs || [];
      const finished = state.jobs.filter((job) => job.status === "done" && prev.find((p) => p.id === job.id && p.status !== "done"));
      const failed = state.jobs.filter((job) => job.status === "error" && prev.find((p) => p.id === job.id && p.status !== "error"));
      if (state.viewPackId) renderPackDetail(state.viewPackId);
      if ($("#inspector") && $("#inspector").classList.contains("on")) renderInspector();
      if (finished.length) {
        toast("Downloaded " + finished.map((x) => x.label).join(", ") + ".");
        scan({ quiet: true, skipSetup: true });
      }
      failed.forEach((job) => toast(job.error || "Download failed.", true));
      const still = state.jobs.some((x) => x.status === "queued" || x.status === "running" || x.status === "cancelling");
      if (!still) {
        clearInterval(syncDlPoll._t);
        syncDlPoll._t = null;
      }
    } catch (_) {}
  }, 900);
}

function openSheet(opts) {
  opts = opts || {};
  state.sheetReturn = opts.returnTo || null;
  $("#overlay").classList.add("on");
  $("#packSheet").classList.add("on");
  renderPacks();
}
function closeSheet() {
  const ret = state.sheetReturn;
  state.sheetReturn = null;
  $("#overlay").classList.remove("on");
  $("#packSheet").classList.remove("on");
  if (ret === "inspector") openInspector();
}
function openInspector() {
  $("#inspector").classList.add("on");
  renderInspector();
}
function closeInspector() {
  $("#inspector").classList.remove("on");
}
function backToGearFromPack() {
  closeInspector();
  openGear();
}
function defaultPrivacy() {
  return { timeoutMin: 0, pinHash: "", cover: "" };
}
function loadPrivacy() {
  try {
    const raw = JSON.parse(localStorage.getItem("yi-privacy") || "{}");
    if (!raw || typeof raw !== "object") return defaultPrivacy();
    return Object.assign(defaultPrivacy(), {
      timeoutMin: Number(raw.timeoutMin) || 0,
      pinHash: String(raw.pinHash || ""),
      cover: String(raw.cover || ""),
    });
  } catch (_) {
    return defaultPrivacy();
  }
}
function persistPrivacy() {
  const p = state.privacy || defaultPrivacy();
  try {
    localStorage.setItem("yi-privacy", JSON.stringify({
      timeoutMin: p.timeoutMin,
      pinHash: p.pinHash,
      cover: p.cover,
    }));
  } catch (_) {
    toast("Could not save privacy settings. The cover image may be too large.", true);
  }
}
async function hashPin(pin) {
  const text = "yi-pin:" + String(pin || "");
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
function cleanPin(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 8);
}
function renderPrivacySettings() {
  const p = state.privacy || loadPrivacy();
  state.privacy = p;
  const to = $("#privacyTimeout");
  if (to) to.value = String(p.timeoutMin);
  const img = $("#privacyPreviewImg");
  const empty = $("#privacyPreviewEmpty");
  if (img && empty) {
    if (p.cover) {
      img.src = p.cover;
      img.hidden = false;
      empty.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      empty.hidden = false;
    }
  }
  const note = $("#privacyPinNote");
  if (note) note.textContent = p.pinHash
    ? "PIN is set. Restarting the app always unlocks a covered session."
    : "Set a PIN before the cover can lock.";
}
function armPrivacyIdle() {
  clearTimeout(state.privacyIdleTimer);
  state.privacyIdleTimer = null;
  const p = state.privacy || loadPrivacy();
  state.privacy = p;
  if (state.privacyLocked) return;
  const min = Number(p.timeoutMin) || 0;
  if (!min || !p.pinHash) return;
  state.privacyIdleTimer = setTimeout(() => lockPrivacy(), min * 60 * 1000);
}
function tickPrivacyClock() {
  const el = $("#privacyClock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function lockPrivacy() {
  const p = state.privacy || loadPrivacy();
  state.privacy = p;
  if (!p.pinHash) {
    toast("Set a PIN in Privacy settings first.", true);
    openGear();
    showGearPrivacy();
    return;
  }
  if (state.privacyLocked) return;
  state.privacyLocked = true;
  clearTimeout(state.privacyIdleTimer);
  state.privacyIdleTimer = null;
  closePackMenu();
  closeAspectPop();
  const cover = $("#privacyCover");
  const img = $("#privacyCoverImg");
  if (img) {
    if (p.cover) {
      img.src = p.cover;
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
    }
  }
  if (cover) cover.hidden = false;
  state.privacyTitle = document.title;
  document.title = "Photos";
  tickPrivacyClock();
  clearInterval(state.privacyClockTimer);
  state.privacyClockTimer = setInterval(tickPrivacyClock, 1000);
  const pin = $("#privacyUnlockPin");
  const err = $("#privacyPinErr");
  if (err) err.hidden = true;
  if (pin) {
    pin.value = "";
    setTimeout(() => pin.focus(), 50);
  }
}
function unlockPrivacy() {
  if (!state.privacyLocked) return;
  state.privacyLocked = false;
  const cover = $("#privacyCover");
  if (cover) cover.hidden = true;
  clearInterval(state.privacyClockTimer);
  state.privacyClockTimer = null;
  if (state.privacyTitle) document.title = state.privacyTitle;
  armPrivacyIdle();
}
async function tryUnlockPrivacy(pin) {
  const p = state.privacy || loadPrivacy();
  const code = cleanPin(pin);
  const err = $("#privacyPinErr");
  if (code.length < 4) {
    if (err) { err.hidden = false; err.textContent = "Enter your PIN."; }
    return false;
  }
  const hash = await hashPin(code);
  if (hash !== p.pinHash) {
    if (err) { err.hidden = false; err.textContent = "Wrong PIN"; }
    return false;
  }
  unlockPrivacy();
  return true;
}
function compressCoverFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1920;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const scale = Math.min(1, max / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}
function notePrivacyActivity() {
  if (state.privacyLocked) return;
  armPrivacyIdle();
}

function showGearHome() {
  const home = $("#gearHome");
  const defs = $("#gearDefaults");
  const priv = $("#gearPrivacy");
  if (home) home.hidden = false;
  if (defs) defs.hidden = true;
  if (priv) priv.hidden = true;
}
function showGearDefaults() {
  const home = $("#gearHome");
  const defs = $("#gearDefaults");
  const priv = $("#gearPrivacy");
  if (home) home.hidden = true;
  if (defs) defs.hidden = false;
  if (priv) priv.hidden = true;
  beginPrefDraft();
}
function showGearPrivacy() {
  const home = $("#gearHome");
  const defs = $("#gearDefaults");
  const priv = $("#gearPrivacy");
  if (home) home.hidden = true;
  if (defs) defs.hidden = true;
  if (priv) priv.hidden = false;
  renderPrivacySettings();
}
function confirmLeavePrefs() {
  if (!state.prefsDirty) return true;
  return window.confirm("You have unsaved default settings. Leave without saving?");
}
function closeGear() {
  if ($("#gearDefaults") && !$("#gearDefaults").hidden && !confirmLeavePrefs()) return false;
  state.prefsDirty = false;
  showGearHome();
  $("#gear").classList.remove("on");
  return true;
}
function openGear() {
  showGearHome();
  renderComfySetup();
  $("#gear").classList.add("on");
}

try {
  if ($("#packChip")) $("#packChip").onclick = (e) => {
    e.stopPropagation();
    togglePackMenu();
  };
  document.addEventListener("click", (e) => {
    const pick = $("#packPick");
    if (pick && !pick.contains(e.target)) closePackMenu();
    const aspectWrap = $("#aspectWrap");
    if (aspectWrap && !aspectWrap.contains(e.target)) closeAspectPop();
  });
  const railBtn = $("#railBtn");
  if (railBtn) railBtn.onclick = toggleRail;
  const negToggle = $("#negToggle");
  if (negToggle) negToggle.onclick = () => setNegOpen(!state.negOpen);
  const negPick = $("#negPick");
  if (negPick) negPick.onchange = applyNegPick;
  const negSave = $("#negSave");
  if (negSave) negSave.onclick = saveCurrentNeg;
  const negDelete = $("#negDelete");
  if (negDelete) negDelete.onclick = deleteSelectedNeg;
  const negBox = $("#neg");
  if (negBox) {
    negBox.addEventListener("input", () => {
      try { localStorage.setItem("yi-neg", negBox.value); } catch (_) {}
    });
  }
  applyRail();
  loadNegatives();
  const overlay = $("#overlay");
  if (overlay) overlay.onclick = () => {
    const packOpen = $("#packSheet") && $("#packSheet").classList.contains("on");
    const libOpen = $("#libSheet") && $("#libSheet").classList.contains("on");
    if (packOpen) closeSheet();
    if (libOpen) {
      closeLibrary();
      if (!packOpen) $("#overlay").classList.remove("on");
    }
  };
  const closePacks = $("#closePacks");
  if (closePacks) closePacks.onclick = closeSheet;
  const openLib = $("#openLib");
  if (openLib) openLib.onclick = openLibrary;
  const closeLib = $("#closeLib");
  if (closeLib) closeLib.onclick = () => {
    closeLibrary();
    $("#overlay").classList.remove("on");
  };
  const refreshLib = $("#refreshLib");
  if (refreshLib) refreshLib.onclick = () => loadLibrary();
  const libSeg = $("#libSeg");
  if (libSeg) {
    libSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b && b.dataset.lib) setLibTab(b.dataset.lib);
    });
  }
  const libSearch = $("#libSearch");
  if (libSearch) {
    libSearch.addEventListener("input", () => {
      state.libQuery = libSearch.value;
      renderLibrary();
    });
  }
  const libKind = $("#libKind");
  if (libKind) {
    libKind.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !b.dataset.kind) return;
      state.libKind = b.dataset.kind;
      [...libKind.querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x.dataset.kind === state.libKind));
      renderLibrary();
    });
  }
  const libSource = $("#libSource");
  if (libSource) {
    libSource.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !b.dataset.source) return;
      state.libSource = b.dataset.source;
      [...libSource.querySelectorAll("button")].forEach((x) => x.classList.toggle("on", x.dataset.source === state.libSource));
      renderLibrary();
    });
  }
  const refreshPacks = $("#refreshPacks");
  if (refreshPacks) refreshPacks.onclick = () => scan({ skipSetup: true });
  const closeInsp = $("#closeInsp");
  if (closeInsp) closeInsp.onclick = closeInspector;
  const backInsp = $("#backInsp");
  if (backInsp) backInsp.onclick = backToGearFromPack;
  const openInsp = $("#openInsp");
  if (openInsp) openInsp.onclick = () => openInspector();
  const muteBtn = $("#muteBtn");
  if (muteBtn) muteBtn.onclick = toggleMute;
  syncMuteUi();
  const openGearBtn = $("#openGear");
  if (openGearBtn) openGearBtn.onclick = () => openGear();
  const closeGearBtn = $("#closeGear");
  if (closeGearBtn) closeGearBtn.onclick = () => closeGear();
  const openDefaults = $("#openDefaults");
  if (openDefaults) openDefaults.onclick = () => showGearDefaults();
  const openPrivacy = $("#openPrivacy");
  if (openPrivacy) openPrivacy.onclick = () => showGearPrivacy();
  const backPrivacy = $("#backPrivacy");
  if (backPrivacy) backPrivacy.onclick = () => showGearHome();
  const backGear = $("#backGear");
  if (backGear) backGear.onclick = () => {
    if (!confirmLeavePrefs()) return;
    state.prefsDirty = false;
    showGearHome();
  };
  const privacyBtn = $("#privacyBtn");
  if (privacyBtn) privacyBtn.onclick = () => lockPrivacy();
  const privacyTimeout = $("#privacyTimeout");
  if (privacyTimeout) privacyTimeout.onchange = () => {
    state.privacy = state.privacy || loadPrivacy();
    state.privacy.timeoutMin = Number(privacyTimeout.value) || 0;
    persistPrivacy();
    armPrivacyIdle();
    toast(state.privacy.timeoutMin ? "Cover after " + state.privacy.timeoutMin + " min idle." : "Idle cover off.");
  };
  const privacyCoverPick = $("#privacyCoverPick");
  const privacyCoverFile = $("#privacyCoverFile");
  if (privacyCoverPick && privacyCoverFile) {
    privacyCoverPick.onclick = () => privacyCoverFile.click();
    privacyCoverFile.onchange = async () => {
      const file = privacyCoverFile.files && privacyCoverFile.files[0];
      privacyCoverFile.value = "";
      if (!file) return;
      try {
        const data = await compressCoverFile(file);
        state.privacy = state.privacy || loadPrivacy();
        state.privacy.cover = data;
        persistPrivacy();
        renderPrivacySettings();
        toast("Cover image saved.");
      } catch (e) {
        toast((e && e.message) || "Could not use that image.", true);
      }
    };
  }
  const privacyCoverClear = $("#privacyCoverClear");
  if (privacyCoverClear) privacyCoverClear.onclick = () => {
    state.privacy = state.privacy || loadPrivacy();
    state.privacy.cover = "";
    persistPrivacy();
    renderPrivacySettings();
    toast("Cover image removed.");
  };
  const privacySavePin = $("#privacySavePin");
  if (privacySavePin) privacySavePin.onclick = async () => {
    const p = state.privacy || loadPrivacy();
    const cur = cleanPin($("#privacyPinCurrent") && $("#privacyPinCurrent").value);
    const neu = cleanPin($("#privacyPinNew") && $("#privacyPinNew").value);
    const conf = cleanPin($("#privacyPinConfirm") && $("#privacyPinConfirm").value);
    if (neu.length < 4 || neu.length > 8) {
      toast("PIN must be 4–8 digits.", true);
      return;
    }
    if (neu !== conf) {
      toast("New PIN and confirm do not match.", true);
      return;
    }
    if (p.pinHash) {
      if (!cur) {
        toast("Enter the current PIN to change it.", true);
        return;
      }
      if (await hashPin(cur) !== p.pinHash) {
        toast("Current PIN is wrong.", true);
        return;
      }
    }
    p.pinHash = await hashPin(neu);
    state.privacy = p;
    persistPrivacy();
    ["privacyPinCurrent", "privacyPinNew", "privacyPinConfirm"].forEach((id) => {
      const el = $("#" + id);
      if (el) el.value = "";
    });
    renderPrivacySettings();
    armPrivacyIdle();
    toast("PIN saved.");
  };
  const privacyUnlock = $("#privacyUnlock");
  if (privacyUnlock) privacyUnlock.onsubmit = async (e) => {
    e.preventDefault();
    await tryUnlockPrivacy($("#privacyUnlockPin") && $("#privacyUnlockPin").value);
  };
  ["mousemove", "mousedown", "keydown", "touchstart", "wheel"].forEach((ev) => {
    document.addEventListener(ev, notePrivacyActivity, { passive: true });
  });
  state.privacy = loadPrivacy();
  renderPrivacySettings();
  armPrivacyIdle();
  const openPackSettings = $("#openPackSettings");
  if (openPackSettings) openPackSettings.onclick = () => {
    if (!closeGear()) return;
    if (!state.pack) {
      toast("Save a default model first, or generate once so a pack is loaded.", true);
      openGear();
      showGearDefaults();
      return;
    }
    openInspector();
  };
  const reconnect = $("#reconnect");
  if (reconnect) reconnect.onclick = connectComfy;
  const disc = $("#disconnectBtn");
  if (disc) disc.onclick = disconnectComfy;
  const connBtn = $("#connectBtn");
  if (connBtn) connBtn.onclick = toggleConnect;
  const settingsConnect = $("#settingsConnect");
  if (settingsConnect) settingsConnect.onclick = connectComfy;
  const settingsDisconnect = $("#settingsDisconnect");
  if (settingsDisconnect) settingsDisconnect.onclick = disconnectComfy;
  const shutdownBtn = $("#shutdownImagine");
  if (shutdownBtn) shutdownBtn.onclick = shutdownImagine;
  const comfyUrl = $("#comfyUrl");
  if (comfyUrl) comfyUrl.addEventListener("input", () => {
    comfyUrl.dataset.dirty = "1";
    if (!state.prefDraft) beginPrefDraft();
    state.prefsDirty = true;
  });
  const modelsRoot = $("#modelsRoot");
  if (modelsRoot) modelsRoot.addEventListener("input", () => {
    if (!state.prefDraft) beginPrefDraft();
    state.prefDraft.modelsRoot = modelsRoot.value;
    state.prefsDirty = true;
  });
  const browseModels = $("#browseModels");
  if (browseModels) browseModels.onclick = async () => {
    const path = await browseFolder("#modelsRoot");
    if (path) {
      if (!state.prefDraft) beginPrefDraft();
      state.prefDraft.modelsRoot = path;
      state.prefsDirty = true;
    }
  };
  const savePrefs = $("#savePrefs");
  if (savePrefs) savePrefs.onclick = saveUserPrefs;
  const settingsComfyBrowse = $("#settingsComfyBrowse");
  if (settingsComfyBrowse) settingsComfyBrowse.onclick = async () => {
    const path = await browseFolder("#settingsComfyRoot", "comfy");
    const el = $("#settingsComfyRoot");
    if (el && path) el.dataset.dirty = "1";
  };
  const settingsComfySave = $("#settingsComfySave");
  if (settingsComfySave) settingsComfySave.onclick = () => saveComfyRootFrom($("#settingsComfyRoot"));
  const settingsComfyStart = $("#settingsComfyStart");
  if (settingsComfyStart) settingsComfyStart.onclick = () => startComfyFromUi($("#settingsComfyRoot"));
  const setupComfyBrowse = $("#setupComfyBrowse");
  if (setupComfyBrowse) setupComfyBrowse.onclick = async () => {
    const path = await browseFolder("#setupComfyRoot", "comfy");
    const el = $("#setupComfyRoot");
    if (el && path) el.dataset.dirty = "1";
  };
  const setupComfyStart = $("#setupComfyStart");
  if (setupComfyStart) setupComfyStart.onclick = () => startComfyFromUi($("#setupComfyRoot"));
  ["settingsComfyRoot", "setupComfyRoot"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.addEventListener("input", () => { el.dataset.dirty = "1"; });
  });
  const setupBrowse = $("#setupBrowse");
  if (setupBrowse) setupBrowse.onclick = () => browseFolder("#setupPath");
  const setupScan = $("#setupScan");
  if (setupScan) setupScan.onclick = async () => {
    const hint = $("#setupHint");
    try {
      const path = ($("#setupPath") && $("#setupPath").value) || "";
      const j = await saveModelsFolder(path, ($("#setupUrl") && $("#setupUrl").value) || comfy());
      const n = (j.packs || []).length;
      const ready = (j.packs || []).filter((p) => p.ready).length;
      if (hint) hint.textContent = "Found " + n + " packs, " + ready + " ready.";
    } catch (e) {
      if (hint) hint.textContent = e.message || "Scan failed.";
    }
  };
  const setupGo = $("#setupGo");
  if (setupGo) setupGo.onclick = async () => {
    try {
      await saveModelsFolder(($("#setupPath") && $("#setupPath").value) || "", ($("#setupUrl") && $("#setupUrl").value) || comfy());
    } catch (e) {
      toast(e.message || "Could not save that folder.", true);
    }
  };
  const vmax = $("#videoMaxMp");
  if (vmax) {
    vmax.value = String(state.videoMaxMP);
    vmax.onchange = () => {
      let n = parseFloat(vmax.value);
      if (!Number.isFinite(n)) n = 0.6;
      n = Math.round(Math.min(1.03, Math.max(0.2, n)) * 100) / 100;
      state.videoMaxMP = n;
      vmax.value = String(n);
      try { localStorage.setItem("yi-video-max-mp", String(n)); } catch (e) {}
      if (state.videoMP > n) state.videoMP = n;
      syncMpControls();
      toast("H3 video cap is " + n.toFixed(2) + "MP. 0.6 is the 8GB sweet spot; ~1.0 gets slow and can OOM.");
    };
  }
  const rb = $("#restartImagine");
  if (rb) rb.onclick = restartImagine;
  const rewrite = $("#rewrite");
  if (rewrite) rewrite.onclick = rewritePrompt;
  fillRewriterSelects();
  const goBtn = $("#go");
  if (goBtn) goBtn.onclick = generate;
  bindHistoryNav();
  const stopBtn = $("#stop");
  if (stopBtn) stopBtn.onclick = interrupt;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (state.running || state.queue.length)) interrupt();
  });
  const modeSeg = $("#modeSeg");
  if (modeSeg) modeSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setUiMode(b.dataset.mode);
  });
  const aspectBtn = $("#aspectBtn");
  if (aspectBtn) aspectBtn.onclick = (e) => {
    e.stopPropagation();
    toggleAspectPop();
  };
  renderAspectPop();
  syncAspectUi();
  const mp = $("#mp");
  if (mp) mp.addEventListener("input", () => setMegapixels(mp.value, "range"));
  const mpNum = $("#mpNum");
  if (mpNum) mpNum.addEventListener("change", () => setMegapixels(mpNum.value, "num"));
  const mpGear = $("#mpGear");
  if (mpGear) mpGear.addEventListener("change", () => setMegapixels(mpGear.value, "gear"));
  const useStill = $("#useStill");
  if (useStill) useStill.onclick = () => attachResult(state.shown, { animate: false });
  const animateStill = $("#animateStill");
  if (animateStill) animateStill.onclick = () => attachResult(state.shown, { animate: true });
  const nsfwChip = $("#nsfwChip");
  if (nsfwChip) {
    nsfwChip.onclick = () => {
      state.nsfw = !state.nsfw;
      nsfwChip.classList.toggle("on", state.nsfw);
      const p = state.pack;
      const n = (p && p.nsfw_loras || []).filter((l) => l.name && state.nsfwOn[l.id]).length;
      if (afterMidnightPicked()) syncAfterMidnightScheduler();
      syncSceneLoraChips();
      toast(state.nsfw
        ? ("NSFW on" + (n ? " — " + n + " adult LoRA(s) for this pack." : (p && p.graph === "flux2_klein" ? " — Klein wrap: wearing nothing / fully nude." : " — prompt wrap for this pack.")))
        : "NSFW off.");
    };
  }
  const sceneChips = $("#sceneLoraChips");
  if (sceneChips) {
    sceneChips.querySelectorAll("[data-scene]").forEach((btn) => {
      btn.onclick = () => {
        if (!state.nsfw) {
          state.nsfw = true;
          const chip = $("#nsfwChip");
          if (chip) chip.classList.toggle("on", true);
        }
        const on = activeSceneLora() === btn.dataset.scene;
        setSceneLora(on ? "" : btn.dataset.scene);
        toast(on
          ? "Scene LoRA off — Bunny can load again."
          : (btn.dataset.scene === "cowgirl"
            ? "Cowgirl on video / I2V — Bunny off. Stills stay clean."
            : btn.textContent + " on video / I2V — Bunny off. Stills stay clean."));
      };
    });
  }
  const durIn = $("#duration");
  if (durIn) {
    durIn.onchange = () => readDuration();
    durIn.onblur = () => readDuration();
  }
  const attach = $("#attach");
  const initFile = $("#initFile");
  async function applyInitFile(file) {
    if (!isImageFile(file)) {
      toast("Drop an image to attach.", true);
      return;
    }
    const url = URL.createObjectURL(file);
    showInit(url);
    state.initUrl = url;
    try {
      state.initName = await uploadInit(file);
      if (state.film && state.film.view) {
        const clip = state.film.clips[state.film.selected];
        if (clip) {
          clip.firstName = state.initName;
          clip.firstUrl = url;
          persistFilm();
          renderFilmClips();
          toast("Start still attached to clip " + (state.film.selected + 1) + ".");
          capMPFromUrl(url);
          return;
        }
      }
      toast("Photo uploaded.");
      capMPFromUrl(url);
    } catch {
      toast("Upload failed — is ComfyUI running?", true);
    }
  }
  if (attach) {
    attach.onclick = (e) => {
      if (!e.target.classList.contains("x") && initFile) initFile.click();
    };
    wireDrop(attach, (files) => {
      const img = files.find(isImageFile);
      if (img) applyInitFile(img);
      else toast("Drop an image to attach.", true);
    });
  }
  const stage = $("#stage");
  if (stage) {
    wireDrop(stage, (files) => {
      const img = files.find(isImageFile);
      if (img) applyInitFile(img);
      else toast("Drop an image to attach.", true);
    }, () => attachOn() && !(state.film && state.film.view));
  }
  const clearInit = $("#clearInit");
  if (clearInit) clearInit.onclick = (e) => {
    e.stopPropagation();
    state.initName = null;
    state.initUrl = null;
    state.initW = 0;
    state.initH = 0;
    if (state.aspect === "auto") {
      syncAspectUi();
      syncSizeReadout();
    }
    if (attach) {
      attach.classList.remove("filled");
      const i = attach.querySelector("img");
      if (i) i.remove();
      syncAttach();
    }
    if (state.pack && state.pack.family === "h3") applyH3ModeSettings();
  };
  if (initFile) initFile.onchange = async (e) => {
    const f = e.target.files[0];
    if (f) applyInitFile(f);
  };
  const idea = $("#idea");
  if (idea) idea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
  });
  setUiMode("image");
} catch (e) {
  console.error(e);
}
if (sessionStorage.getItem("imagine-restarting")) {
  sessionStorage.removeItem("imagine-restarting");
  toast("Your Imagination restarted.");
}
restoreFeed();
bindHistoryNav();
bindStripScroll();
syncStageNav();
applyRail();
loadNegatives();
  bindFilmUi();
  bindRefUi();
  startConnectWatch();
  loadLlmModels().catch((e) => console.error(e));
  scan();
