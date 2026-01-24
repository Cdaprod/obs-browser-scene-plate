/**
 * Program Monitor UI controller.
 * Usage: open /program-monitor/ in the browser.
 */

const fallbackUtils = (() => {
  const STORAGE_KEY = "program-monitor.timeline.v1";
  const audioExt = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
  const imageExt = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  const pageExt = [".html", ".htm"];
  const videoExt = [".mp4", ".mov", ".webm", ".mkv"];

  const parseNodeText = (text) => {
    const lines = (text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("#"));

    return {
      baseUrl: lines[0] || "",
      layers: lines.slice(1),
      lines
    };
  };

  const getDurationHintSeconds = (url) => {
    if (!url) {
      return 0;
    }

    let parsed;
    try {
      parsed = url.includes("://") ? new URL(url) : new URL(url, "http://localhost");
    } catch (error) {
      return 0;
    }

    const params = parsed.searchParams;
    if (!params || Array.from(params.keys()).length === 0) {
      return 0;
    }

    const secondsKeys = new Set(["duration", "dur", "length", "len", "time", "t", "seconds", "sec", "s"]);
    const msKeys = new Set(["ms", "msec", "millis", "milliseconds"]);
    const componentMsKeys = new Set(["in", "out", "hold", "gap", "pause", "delay", "start", "intro", "outro"]);

    for (const key of secondsKeys) {
      const value = params.get(key);
      if (!value) {
        continue;
      }
      const parsedValue = Number.parseFloat(value);
      if (Number.isFinite(parsedValue) && parsedValue > 0) {
        return parsedValue >= 1000 ? parsedValue / 1000 : parsedValue;
      }
    }

    for (const key of msKeys) {
      const value = params.get(key);
      if (!value) {
        continue;
      }
      const parsedValue = Number.parseFloat(value);
      if (Number.isFinite(parsedValue) && parsedValue > 0) {
        return parsedValue / 1000;
      }
    }

    let totalMs = 0;
    params.forEach((value, rawKey) => {
      const key = rawKey.toLowerCase();
      const baseKey = key.replace(/\d+$/, "");
      if (!componentMsKeys.has(baseKey)) {
        return;
      }
      const parsedValue = Number.parseFloat(value);
      if (Number.isFinite(parsedValue) && parsedValue > 0) {
        totalMs += parsedValue;
      }
    });

    if (totalMs > 0) {
      return totalMs / 1000;
    }

    return 0;
  };

  const extractPathname = (url) => {
    if (!url) {
      return "";
    }
    if (!url.includes("://")) {
      return url;
    }
    try {
      return new URL(url).pathname.toLowerCase();
    } catch (error) {
      return url;
    }
  };

  const classifyUrl = (url) => {
    const lower = (url || "").toLowerCase();
    const path = extractPathname(lower);

    if (audioExt.some((ext) => path.endsWith(ext))) {
      return "audio";
    }
    if (imageExt.some((ext) => path.endsWith(ext))) {
      return "image";
    }
    if (pageExt.some((ext) => path.endsWith(ext))) {
      return "page";
    }
    if (videoExt.some((ext) => path.endsWith(ext))) {
      return "video";
    }
    return "video";
  };

  const isHttpUrl = (url) => /^https?:\/\//i.test(url || "");

  const uuid = () => {
    if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    if (typeof window !== "undefined" && window.crypto && typeof window.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `id_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
  };

  return {
    STORAGE_KEY,
    parseNodeText,
    getDurationHintSeconds,
    classifyUrl,
    isHttpUrl,
    uuid
  };
})();

const programMonitorUtils = window.ProgramMonitorUtils || fallbackUtils;
const { classifyUrl, getDurationHintSeconds, isHttpUrl, parseNodeText, STORAGE_KEY, uuid } = programMonitorUtils;

const $ = (selector) => document.querySelector(selector);

const state = {
  nodes: [{ id: uuid(), text: "", durationOverride: "" }],
  selectedIndex: 0,
  activeIndex: 0,
  playing: false,
  stopRequested: false,
  validationResults: []
};

const elements = {
  nodeList: $("#nodeList"),
  mainPanel: document.querySelector(".mainPanel"),
  baseVideo: $("#baseVideo"),
  baseFrame: $("#baseFrame"),
  overlayLayer: $("#overlayLayer"),
  statNode: $("#statNode"),
  statTotal: $("#statTotal"),
  statT: $("#statT"),
  statDur: $("#statDur"),
  fileImport: $("#fileImport"),
  message: $("#message"),
  exportStatus: $("#exportStatus"),
  downloadLink: $("#downloadLink"),
  togglePreview: $("#btnTogglePreview")
};

let overlayVideos = [];
let overlayAudios = [];
let rafId = null;
let baseEndedHandler = null;
let exportPollTimer = null;
let activeBaseKind = "video";
let baseStartTime = 0;
const PREVIEW_COLLAPSE_KEY = "program-monitor.preview-collapsed";

const isFileProtocol = window.location.protocol === "file:";
const host = window.location.hostname || "localhost";
const renderApiPort = 8793;
const webPort = window.location.port || 8789;
const renderApiBase = `http://${host}:${renderApiPort}`;
const downloadBase = `http://${host}:${webPort}`;

function autogrow(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight + 2, 360)}px`;
}

function setMessage(text) {
  elements.message.textContent = text || "";
}

function setExportStatus(text) {
  elements.exportStatus.textContent = text || "";
}

function setDownloadLink(url) {
  if (!url) {
    elements.downloadLink.classList.add("hidden");
    elements.downloadLink.removeAttribute("href");
    return;
  }
  elements.downloadLink.href = url;
  elements.downloadLink.classList.remove("hidden");
}

function setPreviewCollapsed(collapsed) {
  const isCollapsed = Boolean(collapsed);
  document.body.classList.toggle("preview-collapsed", isCollapsed);
  if (elements.togglePreview) {
    elements.togglePreview.setAttribute("aria-pressed", String(!isCollapsed));
  }

  try {
    localStorage.setItem(PREVIEW_COLLAPSE_KEY, JSON.stringify(isCollapsed));
  } catch (error) {
    console.warn("Failed to persist preview state", error);
  }
}

function saveLocal() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        nodes: state.nodes,
        activeIndex: state.activeIndex,
        selectedIndex: state.selectedIndex
      })
    );
  } catch (error) {
    console.warn("Failed to persist timeline", error);
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.nodes) && parsed.nodes.length) {
      state.nodes = parsed.nodes;
      state.activeIndex = Math.min(parsed.activeIndex || 0, state.nodes.length - 1);
      if (parsed.selectedIndex === null) {
        state.selectedIndex = null;
      } else if (Number.isFinite(parsed.selectedIndex)) {
        state.selectedIndex = Math.min(parsed.selectedIndex, state.nodes.length - 1);
      } else {
        state.selectedIndex = state.activeIndex;
      }
    }
  } catch (error) {
    console.warn("Failed to load saved timeline", error);
  }
}

function assertExportReady() {
  if (isFileProtocol) {
    setMessage("Exports require http(s). Serve this page from the stack to enable MOV exports.");
    setExportStatus("Idle");
    return false;
  }
  return true;
}

function exportJSON() {
  const payload = {
    version: 1,
    nodes: state.nodes,
    activeIndex: state.activeIndex
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "program-monitor.timeline.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importJSONFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload || !Array.isArray(payload.nodes) || !payload.nodes.length) {
    throw new Error("Invalid timeline JSON");
  }
  state.nodes = payload.nodes;
  state.activeIndex = 0;
  state.selectedIndex = 0;
  state.validationResults = [];
  renderNodes();
  await primeNode(state.activeIndex);
  saveLocal();
}

function renderNodes() {
  if (!elements.nodeList) {
    return;
  }
  elements.nodeList.innerHTML = "";
  elements.statTotal.textContent = String(state.nodes.length);

  state.nodes.forEach((node, index) => {
    const card = document.createElement("div");
    const isSelected = state.selectedIndex === index;
    const isPlayingActive = state.playing && index === state.activeIndex;
    card.className = "nodeCard" + (isSelected || isPlayingActive ? " active" : "");

    const header = document.createElement("div");
    header.className = "nodeHdr";
    header.innerHTML = `
      <div class="idx">Node ${index + 1}</div>
      <div class="mini">${isPlayingActive || isSelected ? "ACTIVE" : "tap to select"}</div>
    `;

    const textarea = document.createElement("textarea");
    textarea.value = node.text || "";
    textarea.placeholder = `Base video first line.
Then overlays/audio per line.

Example:
http://host/clip.mp4
http://host/overlay.webm
http://host/ambience.mp3`;
    autogrow(textarea);

    const ensureSelected = () => {
      if (state.playing) {
        return;
      }
      if (state.selectedIndex === index && state.activeIndex === index) {
        return;
      }
      state.selectedIndex = index;
      state.activeIndex = index;
      renderNodes();
      saveLocal();
    };

    textarea.addEventListener("input", () => {
      node.text = textarea.value;
      autogrow(textarea);
      saveLocal();
      state.validationResults = [];
      if (!state.playing && index === state.activeIndex) {
        primeNode(index).catch(() => {});
      }
    });
    textarea.addEventListener("focus", ensureSelected);

    textarea.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    textarea.addEventListener("touchstart", (event) => {
      event.stopPropagation();
    });

    const durationRow = document.createElement("div");
    durationRow.className = "nodeDuration";
    durationRow.innerHTML = `
      <label>Duration override (sec)</label>
      <input type="number" min="0" step="0.1" placeholder="auto" />
    `;

    const durationInput = durationRow.querySelector("input");
    durationInput.value = node.durationOverride || "";
    durationInput.addEventListener("input", () => {
      node.durationOverride = durationInput.value;
      saveLocal();
      if (!state.playing && index === state.activeIndex) {
        primeNode(index).catch(() => {});
      }
    });
    durationInput.addEventListener("focus", ensureSelected);
    durationInput.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    durationInput.addEventListener("touchstart", (event) => {
      event.stopPropagation();
    });

    card.addEventListener("click", async () => {
      if (state.playing) {
        return;
      }
      state.selectedIndex = index;
      state.activeIndex = index;
      renderNodes();
      await primeNode(index);
      saveLocal();
    });

    const hint = document.createElement("div");
    hint.className = "nodeHint";
    hint.textContent = "Line 1 = duration source (base). Remaining lines = layers that loop & clip to base.";

    card.appendChild(header);
    card.appendChild(textarea);
    card.appendChild(hint);
    card.appendChild(durationRow);

    const validation = state.validationResults[index];
    if (validation) {
      const block = document.createElement("div");
      block.className = "nodeValidation";

      const issues = validation.issues.length
        ? validation.issues.map((issue) => `<li>${issue}</li>`).join("")
        : "<li>OK</li>";

      block.innerHTML = `
        <div class="validationTitle">Validation</div>
        <ul>${issues}</ul>
        <div class="validationMeta">
          base: ${validation.counts.base} · overlays: ${validation.counts.overlays} · audio: ${validation.counts.audio} · images: ${validation.counts.images}
        </div>
        <div class="validationMeta">Reachability not checked.</div>
      `;
      card.appendChild(block);
    }

    elements.nodeList.appendChild(card);
  });

  if (state.playing) {
    elements.statNode.textContent = String(state.activeIndex + 1);
  } else if (state.selectedIndex === null || state.selectedIndex === undefined) {
    elements.statNode.textContent = "—";
  } else {
    elements.statNode.textContent = String(state.selectedIndex + 1);
  }
}

function clearSelection() {
  if (state.selectedIndex === null || state.selectedIndex === undefined) {
    return;
  }
  state.selectedIndex = null;
  renderNodes();
  saveLocal();
}

function clearLayers() {
  overlayVideos.forEach((video) => video.pause());
  overlayAudios.forEach((audio) => audio.pause());
  overlayVideos = [];
  overlayAudios = [];
  elements.overlayLayer.innerHTML = "";
}

function setBaseKind(kind, url) {
  activeBaseKind = kind;
  if (kind === "page") {
    elements.baseVideo.pause();
    elements.baseVideo.removeAttribute("src");
    elements.baseVideo.style.display = "none";
    elements.baseFrame.style.display = "block";
    elements.baseFrame.src = url || "about:blank";
  } else {
    elements.baseFrame.removeAttribute("src");
    elements.baseFrame.style.display = "none";
    elements.baseVideo.style.display = "block";
  }
}

function clearExportPoll() {
  if (exportPollTimer) {
    clearInterval(exportPollTimer);
    exportPollTimer = null;
  }
}

function clearBaseHandlers() {
  if (baseEndedHandler) {
    elements.baseVideo.removeEventListener("ended", baseEndedHandler);
    baseEndedHandler = null;
  }
}

function resolveDurationSeconds({ baseKind, baseUrl, overrideSeconds, baseDuration, durationHintSeconds }) {
  const override = Number.isFinite(overrideSeconds) && overrideSeconds > 0 ? overrideSeconds : 0;
  const base = Number.isFinite(baseDuration) && baseDuration > 0 ? baseDuration : 0;
  const hintValue = Number.isFinite(durationHintSeconds) ? durationHintSeconds : getDurationHintSeconds(baseUrl);
  const hint = Number.isFinite(hintValue) && hintValue > 0 ? hintValue : 0;

  if (baseKind === "page") {
    return override || hint;
  }

  return base || override || hint;
}

function loadVideoMeta(videoEl, url) {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve(videoEl.duration || 0);
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`Failed to load video metadata: ${url}`));
    };
    const cleanup = () => {
      videoEl.removeEventListener("loadedmetadata", onLoaded);
      videoEl.removeEventListener("error", onErr);
    };

    videoEl.addEventListener("loadedmetadata", onLoaded, { once: true });
    videoEl.addEventListener("error", onErr, { once: true });
    videoEl.src = url;
    videoEl.load();
  });
}

async function primeNode(index) {
  clearLayers();
  clearBaseHandlers();
  const node = state.nodes[index];
  const parsed = parseNodeText(node.text);
  const overrideSeconds = Number(node.durationOverride);
  const baseKind = classifyUrl(parsed.baseUrl);
  const durationHintSeconds = getDurationHintSeconds(parsed.baseUrl);

  setMessage("");

  if (!parsed.baseUrl) {
    setBaseKind("video");
    elements.baseVideo.removeAttribute("src");
    elements.baseFrame.removeAttribute("src");
    elements.statDur.textContent = "0.00";
    return;
  }

  if (baseKind === "page") {
    setBaseKind("page", parsed.baseUrl);
  } else {
    setBaseKind("video", parsed.baseUrl);
  }

  let duration = 0;
  if (baseKind === "page") {
    if (Number.isFinite(overrideSeconds) && overrideSeconds > 0) {
      duration = overrideSeconds;
      setMessage("Using duration override for HTML source.");
    } else if (Number.isFinite(durationHintSeconds) && durationHintSeconds > 0) {
      duration = durationHintSeconds;
      setMessage("Using duration hint from URL parameters.");
    } else {
      setMessage("Base duration unknown. Add a duration override to enable playback.");
    }
  } else {
    elements.baseVideo.loop = false;
    elements.baseVideo.muted = false;
    elements.baseVideo.playsInline = true;
    elements.baseVideo.preload = "metadata";

    try {
      duration = await loadVideoMeta(elements.baseVideo, parsed.baseUrl);
    } catch (error) {
      duration = 0;
    }
  }

  duration = resolveDurationSeconds({
    baseKind,
    baseUrl: parsed.baseUrl,
    overrideSeconds,
    baseDuration: duration,
    durationHintSeconds
  });

  if (!duration && baseKind !== "page") {
    if (Number.isFinite(overrideSeconds) && overrideSeconds > 0) {
      setMessage("Using duration override for streaming source.");
    } else if (Number.isFinite(durationHintSeconds) && durationHintSeconds > 0) {
      setMessage("Using duration hint from URL parameters.");
    } else {
      setMessage("Base duration unknown. Add a duration override to enable playback.");
    }
  }

  elements.statDur.textContent = duration.toFixed(2);

  parsed.layers.forEach((url) => {
    const kind = classifyUrl(url);
    if (kind === "audio") {
      const audio = document.createElement("audio");
      audio.src = url;
      audio.loop = true;
      audio.preload = "auto";
      overlayAudios.push(audio);
      return;
    }

    if (kind === "image") {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      elements.overlayLayer.appendChild(image);
      return;
    }
    if (kind === "page") {
      const frame = document.createElement("iframe");
      frame.src = url;
      frame.title = "Overlay URL";
      frame.loading = "eager";
      frame.setAttribute("aria-hidden", "true");
      elements.overlayLayer.appendChild(frame);
      return;
    }

    const video = document.createElement("video");
    video.src = url;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    elements.overlayLayer.appendChild(video);
    overlayVideos.push(video);
  });
}

function stopAll() {
  state.stopRequested = true;
  state.playing = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  clearBaseHandlers();

  elements.baseVideo.pause();
  elements.baseVideo.currentTime = 0;
  overlayVideos.forEach((video) => {
    video.pause();
    video.currentTime = 0;
  });
  overlayAudios.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });

  elements.statT.textContent = "0.00";
  renderNodes();
}

function pauseAll() {
  state.playing = false;
  elements.baseVideo.pause();
  overlayVideos.forEach((video) => video.pause());
  overlayAudios.forEach((audio) => audio.pause());
  renderNodes();
}

async function playActive() {
  state.stopRequested = false;
  state.playing = true;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (state.selectedIndex === null || state.selectedIndex === undefined) {
    state.activeIndex = 0;
  } else {
    state.activeIndex = state.selectedIndex;
  }
  renderNodes();
  const index = state.activeIndex;
  const overrideSeconds = Number(state.nodes[index].durationOverride);
  elements.statNode.textContent = String(index + 1);

  await primeNode(index);

  const parsed = parseNodeText(state.nodes[index].text);
  const durationHintSeconds = getDurationHintSeconds(parsed.baseUrl);
  if (!parsed.baseUrl) {
    state.playing = false;
    return;
  }
  const baseKind = classifyUrl(parsed.baseUrl);
  activeBaseKind = baseKind;
  baseStartTime = performance.now();

  overlayVideos.forEach((video) => {
    video.currentTime = 0;
    video.play().catch(() => {});
  });
  overlayAudios.forEach((audio) => {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  });

  if (baseKind !== "page") {
    elements.baseVideo.currentTime = 0;
    await elements.baseVideo.play().catch(() => {
      state.playing = false;
    });
  }

  let advanced = false;
  const advance = () => {
    if (advanced) {
      return;
    }
    advanced = true;

    overlayVideos.forEach((video) => video.pause());
    overlayAudios.forEach((audio) => audio.pause());
    elements.baseVideo.pause();

    if (state.stopRequested) {
      state.playing = false;
      return;
    }

    if (state.activeIndex < state.nodes.length - 1) {
      state.activeIndex += 1;
      renderNodes();
      playActive().catch(() => {});
    } else {
      state.playing = false;
      renderNodes();
    }
  };

  clearBaseHandlers();
  if (baseKind !== "page") {
    baseEndedHandler = () => {
      if (state.playing) {
        advance();
      }
    };
    elements.baseVideo.addEventListener("ended", baseEndedHandler);
  }

  const tick = () => {
    if (!state.playing) {
      return;
    }

    const current = activeBaseKind === "page"
      ? (performance.now() - baseStartTime) / 1000
      : (elements.baseVideo.currentTime || 0);
    const duration = resolveDurationSeconds({
      baseKind: activeBaseKind,
      baseUrl: parsed.baseUrl,
      overrideSeconds,
      baseDuration: elements.baseVideo.duration,
      durationHintSeconds
    });

    elements.statT.textContent = current.toFixed(2);
    elements.statDur.textContent = (Number.isFinite(duration) ? duration : 0).toFixed(2);

    if (duration && current >= duration - 0.05) {
      advance();
      return;
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

function openBaseInNewTab() {
  const index = state.selectedIndex ?? state.activeIndex;
  const parsed = parseNodeText(state.nodes[index].text);
  if (!parsed.baseUrl) {
    setMessage("No base URL set for this node.");
    return;
  }
  window.open(parsed.baseUrl, "_blank", "noopener");
}

function validateNodes() {
  state.validationResults = state.nodes.map((node) => {
    const parsed = parseNodeText(node.text);
    const issues = [];
    const counts = {
      base: parsed.baseUrl ? 1 : 0,
      overlays: parsed.layers.length,
      audio: 0,
      images: 0
    };

    if (!parsed.baseUrl) {
      issues.push("Missing base URL.");
    } else if (!isHttpUrl(parsed.baseUrl)) {
      issues.push("Base URL should start with http(s). Reachability not checked.");
    }

    parsed.layers.forEach((url) => {
      const kind = classifyUrl(url);
      if (kind === "audio") {
        counts.audio += 1;
      } else if (kind === "image") {
        counts.images += 1;
      }

      if (!isHttpUrl(url)) {
        issues.push(`Layer URL not http(s): ${url}`);
      }
    });

    return { issues, counts };
  });

  renderNodes();
}

async function pollJobStatus(statusUrl) {
  const res = await fetch(statusUrl);
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "status_failed");
  }

  if (data.state === "ready") {
    const downloadUrl = data.download_url
      ? `${downloadBase}${data.download_url}`
      : null;
    setExportStatus("Ready");
    setDownloadLink(downloadUrl);
    clearExportPoll();
  } else if (data.state === "error") {
    setExportStatus("Error");
    clearExportPoll();
  } else if (data.state === "encoding") {
    setExportStatus("Encoding");
  } else if (data.state === "rendering") {
    setExportStatus("Rendering");
  } else {
    setExportStatus("Queued");
  }
}

async function exportNode() {
  clearExportPoll();
  setExportStatus("Queued");
  setDownloadLink("");

  if (!assertExportReady()) {
    return;
  }

  const node = state.nodes[state.activeIndex];
  if (!node || !node.text.trim()) {
    setMessage("Add at least one URL line before exporting.");
    setExportStatus("Idle");
    return;
  }

  const res = await fetch(`${renderApiBase}/api/program-monitor/export-node`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node: { text: node.text },
      options: { fps: 60, width: 1080, height: 1920 }
    })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "export_failed");
  }

  if (data.download_url) {
    setExportStatus("Ready");
    setDownloadLink(`${downloadBase}${data.download_url}`);
    return;
  }

  if (!data.status_url) {
    throw new Error("missing_status_url");
  }

  const statusUrl = `${renderApiBase}${data.status_url}`;
  exportPollTimer = setInterval(() => {
    pollJobStatus(statusUrl).catch((error) => {
      console.error(error);
      setExportStatus("Error");
      clearExportPoll();
    });
  }, 1000);
}

async function exportTimeline() {
  clearExportPoll();
  setExportStatus("Queued");
  setDownloadLink("");

  if (!assertExportReady()) {
    return;
  }

  if (!state.nodes.length) {
    setMessage("Add at least one node before exporting.");
    setExportStatus("Idle");
    return;
  }

  const res = await fetch(`${renderApiBase}/api/program-monitor/export-timeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeline: { version: 1, nodes: state.nodes },
      options: { fps: 60, width: 1080, height: 1920 }
    })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "export_failed");
  }

  if (data.download_url) {
    setExportStatus("Ready");
    setDownloadLink(`${downloadBase}${data.download_url}`);
    return;
  }

  if (!data.status_url) {
    throw new Error("missing_status_url");
  }

  const statusUrl = `${renderApiBase}${data.status_url}`;
  exportPollTimer = setInterval(() => {
    pollJobStatus(statusUrl).catch((error) => {
      console.error(error);
      setExportStatus("Error");
      clearExportPoll();
    });
  }, 1200);
}

$("#btnAdd").addEventListener("click", () => {
  if (state.playing) {
    return;
  }
  state.nodes.push({ id: uuid(), text: "", durationOverride: "" });
  state.activeIndex = state.nodes.length - 1;
  state.selectedIndex = state.activeIndex;
  state.validationResults = [];
  renderNodes();
  saveLocal();
});

$("#btnDelete").addEventListener("click", () => {
  if (state.playing) {
    return;
  }
  if (state.nodes.length <= 1) {
    return;
  }
  state.nodes.splice(state.activeIndex, 1);
  state.activeIndex = Math.max(0, state.activeIndex - 1);
  state.selectedIndex = state.activeIndex;
  state.validationResults = [];
  renderNodes();
  saveLocal();
});

$("#btnPrev").addEventListener("click", async () => {
  if (state.playing) {
    return;
  }
  state.activeIndex = Math.max(0, state.activeIndex - 1);
  state.selectedIndex = state.activeIndex;
  state.validationResults = [];
  renderNodes();
  await primeNode(state.activeIndex);
  saveLocal();
});

$("#btnNext").addEventListener("click", async () => {
  if (state.playing) {
    return;
  }
  state.activeIndex = Math.min(state.nodes.length - 1, state.activeIndex + 1);
  state.selectedIndex = state.activeIndex;
  state.validationResults = [];
  renderNodes();
  await primeNode(state.activeIndex);
  saveLocal();
});

$("#btnPlay").addEventListener("click", () => {
  if (state.playing) {
    return;
  }
  playActive().catch(() => {});
});

$("#btnPause").addEventListener("click", () => pauseAll());
$("#btnStop").addEventListener("click", () => stopAll());

$("#btnSave").addEventListener("click", () => saveLocal());
$("#btnExport").addEventListener("click", () => exportJSON());
$("#btnImport").addEventListener("click", () => elements.fileImport.click());
$("#btnValidate").addEventListener("click", () => validateNodes());
$("#btnOpenBase").addEventListener("click", () => openBaseInNewTab());
$("#btnExportNode").addEventListener("click", () => {
  exportNode().catch((error) => {
    console.error(error);
    setExportStatus("Error");
  });
});
$("#btnExportTimeline").addEventListener("click", () => {
  exportTimeline().catch((error) => {
    console.error(error);
    setExportStatus("Error");
  });
});

if (elements.togglePreview) {
  elements.togglePreview.addEventListener("click", () => {
    const isCollapsed = document.body.classList.contains("preview-collapsed");
    setPreviewCollapsed(!isCollapsed);
  });
}

if (elements.mainPanel) {
  elements.mainPanel.addEventListener("click", (event) => {
    if (state.playing) {
      return;
    }
    if (event.target.closest(".nodeCard")) {
      return;
    }
    if (event.target.closest("button, input, textarea, select, option, a, label")) {
      return;
    }
    clearSelection();
  });
}

elements.fileImport.addEventListener("change", async () => {
  const file = elements.fileImport.files?.[0];
  if (!file) {
    return;
  }
  try {
    await importJSONFile(file);
  } catch (error) {
    setMessage(`Import failed: ${error.message || error}`);
  } finally {
    elements.fileImport.value = "";
  }
});

try {
  loadLocal();
  try {
    const stored = localStorage.getItem(PREVIEW_COLLAPSE_KEY);
    if (stored !== null) {
      setPreviewCollapsed(JSON.parse(stored));
    } else {
      setPreviewCollapsed(false);
    }
  } catch (error) {
    console.warn("Failed to load preview state", error);
    setPreviewCollapsed(false);
  }
  renderNodes();
  primeNode(state.activeIndex).catch(() => {});
  setExportStatus("Idle");
} catch (error) {
  console.error(error);
  setMessage(`Startup error: ${error?.message || error}`);
}
