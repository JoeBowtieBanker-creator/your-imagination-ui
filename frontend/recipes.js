/* recipes.js — client helper; rewrite itself lives on the server. */
window.ImagineRecipes = {
  lastError: "",
  lastSource: "structure",
  async rewrite(idea, opts) {
    opts = opts || {};
    const model = opts.model || "structure";
    const payload = {
      idea,
      text: idea,
      shot: opts.shot || idea,
      recipe: opts.recipe || "photo",
      pack: opts.pack || opts.recipe || "photo",
      mode: opts.mode || "t2i",
      style: opts.style || "",
      camera: opts.camera || "",
      has_image: !!opts.has_image,
      nsfw: !!opts.nsfw,
      h3_path: opts.h3_path || "",
      ref_count: opts.ref_count || 0,
      has_last: !!opts.has_last,
      character_tags: Array.isArray(opts.character_tags)
        ? opts.character_tags
        : (Array.isArray(opts.ref_names) ? opts.ref_names : []),
      scene_flags: Array.isArray(opts.scene_flags) ? opts.scene_flags : [],
      duration: opts.duration || 0,
      want_audio: opts.want_audio,
      film: !!opts.film,
      scene_lora: opts.scene_lora || "",
      dialogue: opts.dialogue || "",
      soundscape: opts.soundscape || "",
      music: opts.music || "",
      model,
    };
    const useLlm = model && model !== "structure";
    const path = useLlm ? "/api/llm-rewrite" : "/api/rewrite";
    this.lastError = "";
    this.lastSource = "structure";
    let j;
    if (typeof apiFetch === "function") {
      j = await apiFetch(path, { method: "POST", body: JSON.stringify(payload) });
    } else {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      j = await r.json();
    }
    if (!j || !j.ok) throw new Error((j && j.error) || "rewrite failed");
    this.lastError = j.error || "";
    this.lastSource = j.source || (useLlm ? "llm" : "structure");
    return j.prompt;
  },
};
