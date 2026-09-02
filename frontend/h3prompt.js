/* ============================================================================
   h3prompt.js — MiniMax H3 structured-prompt assembler.

   Takes plain fields the user fills in and arranges them into H3's official
   structure for the chosen mode. Pure string assembly — no network, works
   offline. The optional "enhance" path (in index.html) can send the assembled
   draft to an LLM, but this module always produces a valid prompt on its own.

   Modes:
     t2va   Text-to-Video + Audio     (no frame anchor)
     i2va   Image-to-Video            (image = first frame at 0.00s)
     fl2va  First-and-Last Frame      (two images, motion interpolated between)
     l2va   Last-Frame                (image = final frame, model infers opening)
     r2va   Reference-to-Video        (identity stills as <Picture 1> / <Picture 2>, not a first frame)

   Structure follows MiniMax's base prompt guide:
     [optional frame-alignment line]
     integrated_multimodal_description: [Shot N] ...
     overall_soundscape: ...
     non_diegetic_music: ...
     dialogue: ...

   Ref2VA must name <Picture i> (angle brackets). "Image 1" and untagged
   "Picture 1 is the identity lock" do not bind the reference tokens.
   ============================================================================ */

const H3 = (() => {

  // camera phrasing: motion type first, then optional qualifier
  function cameraPhrase(motion, qualifier) {
    if (!motion || motion === "none") return "";
    const map = {
      static: "the camera holds steady",
      push_in: "the camera slowly pushes in",
      pull_out: "the camera slowly pulls back",
      pan_left: "the camera pans left",
      pan_right: "the camera pans right",
      tilt_up: "the camera tilts up",
      tilt_down: "the camera tilts down",
      track: "the camera tracks alongside the subject",
      orbit: "the camera arcs around the subject",
      handheld: "a loose handheld camera follows the action",
      crane_up: "the camera cranes upward to a high angle",
    };
    let base = map[motion] || motion;
    if (qualifier && qualifier.trim()) base += `, ${qualifier.trim()}`;
    return base;
  }

  function shotSize(size) {
    const map = {
      auto: "",
      ecu: "extreme close-up",
      cu: "close-up",
      mcu: "medium close-up",
      ms: "medium shot",
      mws: "medium-wide shot",
      ws: "wide shot",
    };
    return map[size] || "";
  }

  function styleLead(style) {
    const s = (style || "").trim();
    if (!s) return "Live-action, cinematic";
    return s;
  }

  // Build the integrated_multimodal_description body from fields.
  function buildBody(f) {
    const parts = [];
    const size = shotSize(f.shot);
    const lead = styleLead(f.style);
    const shotHead = `[Shot 1] ${lead}${size ? `, a ${size}` : ""}`;

    // opening anchor differs by mode
    let opening;
    if (f.mode === "i2va") {
      opening = `begins exactly from the composition in Picture 1`;
      if (f.subject) opening += `: ${f.subject.trim()}`;
    } else if (f.mode === "r2va") {
      opening = `<Picture 1> and <Picture 2> appear as themselves`;
      if (f.subject) opening += `: ${f.subject.trim()}`;
    } else if (f.mode === "fl2va") {
      opening = `opens on the composition in Picture 1`;
      if (f.subject) opening += `: ${f.subject.trim()}`;
    } else if (f.mode === "l2va") {
      opening = f.subject
        ? `opens on a plausible earlier state: ${f.subject.trim()}`
        : `opens on a plausible earlier state that will resolve into Picture 1`;
    } else {
      // t2va
      opening = f.subject ? `establishes ${f.subject.trim()}` : `establishes the scene`;
    }

    let sentence = `${shotHead} ${opening}.`;

    // preservation / consistency
    if (f.keep && f.keep.trim()) {
      sentence += ` Keep consistent throughout: ${f.keep.trim()}.`;
    }

    // action / what changes
    if (f.action && f.action.trim()) {
      sentence += ` ${f.action.trim()}`;
      if (!/[.!?]$/.test(sentence)) sentence += ".";
    }

    // environment change
    if (f.environment && f.environment.trim()) {
      sentence += ` ${f.environment.trim()}`;
      if (!/[.!?]$/.test(sentence)) sentence += ".";
    }

    // camera
    const cam = cameraPhrase(f.camera, f.cameraQualifier);
    if (cam) sentence += ` Throughout, ${cam}.`;

    // ending / landing
    if (f.mode === "fl2va" || f.mode === "l2va") {
      sentence += ` The shot gradually converges so the final frame matches Picture ${f.mode === "fl2va" ? "2" : "1"}.`;
    } else if (f.ending && f.ending.trim()) {
      sentence += ` ${f.ending.trim()}`;
      if (!/[.!?]$/.test(sentence)) sentence += ".";
    }

    // Visuals only here. Spoken lines go in dialogue:; foley goes in overall_soundscape:.

    return sentence;
  }

  // frame-alignment line that must precede the body for image modes
  function alignmentLine(mode) {
    switch (mode) {
      case "i2va":
        return "Picture 1 is the exact first frame of the video at 0.00 seconds and belongs to [Shot 1].";
      case "r2va":
        return "<Picture 1> is Character 1 — that exact face and hair. <Picture 2> is Character 2 — that exact face and hair. These are identity references, not the first frame.";
      case "fl2va":
        return "Picture 1 is the first frame at 0.00 seconds; Picture 2 is the final frame. Interpolate the motion between them in a single continuous shot.";
      case "l2va":
        return "Picture 1 is the exact final frame of the video and belongs to the last shot; infer a plausible earlier state and converge toward it.";
      default:
        return ""; // t2va needs no alignment line
    }
  }

  // assemble the whole thing
  function assemble(f) {
    const lines = [];
    const align = alignmentLine(f.mode);
    if (align) lines.push(align);

    const diegetic = (f.diegetic && f.diegetic.trim()) ? f.diegetic.trim() : "";
    let soundscape = (f.soundscape && f.soundscape.trim())
      ? f.soundscape.trim()
      : (diegetic || "room tone");
    soundscape = soundscape
      .replace(/\b(matching the scene( only)?|under the spoken line|no speech|no narration|no narrator|no voiceover)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const scWords = soundscape.split(/\s+/).filter(Boolean);
    if (scWords.length > 15) soundscape = scWords.slice(0, 15).join(" ");

    const music = (f.music && f.music.trim()) ? f.music.trim() : "N/A";

    const rawLine = (f.dialogue && f.dialogue.trim()) ? f.dialogue.trim() : "";
    const spoken = (rawLine && rawLine.length <= 120 && rawLine.split(/\s+/).length <= 20
      && !/\[Shot\s+\d+\]|integrated_multimodal_description|begins exactly|Live-action|matching the scene/i.test(rawLine))
      ? `"${rawLine.replace(/^["“”']+|["“”']+$/g, "")}"`
      : "none";

    let body = buildBody(f);
    if (spoken === "none" && !/\[no speaker\]/i.test(body)) {
      body = body.replace(/[. ]*$/, "") + " [no speaker]";
    }
    lines.push(`integrated_multimodal_description: ${body}`);
    lines.push(`dialogue: ${spoken}`);
    lines.push(`overall_soundscape: ${soundscape || "room tone"}`);
    lines.push(`non_diegetic_music: ${music}`);

    return lines.join("\n");
  }

  // a compact natural-language version (some prefer feeding H3 loose prose;
  // H3-Context-IR will structure it). Useful as an alternative output.
  function assembleProse(f) {
    const bits = [];
    if (f.mode === "i2va") bits.push("Starting from the attached image as the first frame,");
    else if (f.mode === "r2va") bits.push("<Picture 1> and <Picture 2> appear as themselves.");
    else if (f.mode === "fl2va") bits.push("Moving from the first image to the second image as the final frame,");
    else if (f.mode === "l2va") bits.push("Ending on the attached image as the final frame,");
    if (f.subject) bits.push(f.subject.trim() + ".");
    if (f.keep) bits.push("Keep consistent: " + f.keep.trim() + ".");
    if (f.action) bits.push(f.action.trim() + ".");
    if (f.environment) bits.push(f.environment.trim() + ".");
    const cam = cameraPhrase(f.camera, f.cameraQualifier);
    if (cam) bits.push(cam.charAt(0).toUpperCase() + cam.slice(1) + ".");
    if (f.ending && f.mode === "t2va") bits.push(f.ending.trim() + ".");
    if (f.dialogue) bits.push(`Dialogue: "${f.dialogue.trim()}".`);
    let out = bits.join(" ").replace(/\.\./g, ".");
    if (f.soundscape) out += ` Ambient sound: ${f.soundscape.trim()}.`;
    if (f.dialogue || f.diegetic) out += ` Include synchronized native audio.`;
    if (f.music) out += ` Music: ${f.music.trim()}.`;
    return out;
  }

  // quick validation to warn about the common mistakes the guides call out
  function warnings(f) {
    const w = [];
    if ((f.mode === "i2va" || f.mode === "fl2va" || f.mode === "l2va") && !f.action) {
      w.push("Image modes work best when you describe what CHANGES, not the still. Add an action.");
    }
    if (f.mode === "t2va" && !f.subject) {
      w.push("Text-to-video needs a subject/scene to establish.");
    }
    // competing camera moves
    if (f.cameraQualifier && /(then|and then|after that).*(pan|push|tilt|track|orbit)/i.test(f.cameraQualifier)) {
      w.push("Avoid stacking several camera moves in one short shot — pick one primary move.");
    }
    // sound repeated across fields
    if (f.diegetic && f.soundscape &&
        f.diegetic.trim().toLowerCase() === f.soundscape.trim().toLowerCase()) {
      w.push("Same sound in timeline and soundscape — keep them distinct to avoid competing cues.");
    }
    return w;
  }

  return { assemble, assembleProse, warnings };
})();

// expose for the page
window.H3 = H3;
