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
    const rawLines = (text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("#"));

    const explicitBaseIndex = rawLines.findIndex((line) => /^base\s*:/i.test(line));
    const lines = rawLines.map((line, index) => {
      if (index === explicitBaseIndex) {
        return line.replace(/^base\s*:/i, "").trim();
      }
      return line;
    });

    let baseIndex = 0;
    if (explicitBaseIndex >= 0) {
      baseIndex = explicitBaseIndex;
    } else if (lines.length > 1) {
      const nonAudioLines = lines.filter((line) => classifyUrl(line) !== "audio");
      const overlayLike = (line) => /\/overlays?\//i.test(line);
      const nonOverlayLines = nonAudioLines.filter((line) => !overlayLike(line));
      if (nonOverlayLines.length && lines.some(overlayLike)) {
        baseIndex = lines.lastIndexOf(nonOverlayLines[nonOverlayLines.length - 1]);
      }
    }

    const baseUrl = lines[baseIndex] || "";
    const layers = lines.filter((_, index) => index !== baseIndex);

    return {
      baseUrl,
      layers,
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
      return Math.max(totalMs / 1000, getTypewriterDurationHintSeconds(params));
    }

    const typewriterHint = getTypewriterDurationHintSeconds(params);
    if (typewriterHint > 0) {
      return typewriterHint;
    }

    return 0;
  };

  const getTypewriterDurationHintSeconds = (params) => {
    if (!params) {
      return 0;
    }

    const sentenceEntries = [];
    params.forEach((value, key) => {
      if (!value) {
        return;
      }
      if (/^s\d+$/i.test(key)) {
        sentenceEntries.push(value);
      }
    });

    if (!sentenceEntries.length) {
      return 0;
    }

    const cps = Number.parseFloat(params.get("cps") || "22");
    const inMs = Number.parseFloat(params.get("in") || "420");
    const outMs = Number.parseFloat(params.get("out") || "360");
    const holdMs = Number.parseFloat(params.get("hold") || "2600");
    const gapMs = Number.parseFloat(params.get("gap") || "320");
    const pauseMs = Number.parseFloat(params.get("pause") || "650");

    const safeCps = Number.isFinite(cps) && cps > 0 ? cps : 22;
    const safeIn = Number.isFinite(inMs) && inMs >= 0 ? inMs : 0;
    const safeOut = Number.isFinite(outMs) && outMs >= 0 ? outMs : 0;
    const safeHold = Number.isFinite(holdMs) && holdMs >= 0 ? holdMs : 0;
    const safeGap = Number.isFinite(gapMs) && gapMs >= 0 ? gapMs : 0;
    const safePause = Number.isFinite(pauseMs) && pauseMs >= 0 ? pauseMs : 0;

    const typingMs = sentenceEntries.reduce((total, sentence) => {
      const length = sentence.trim().length;
      return total + (length / safeCps) * 1000;
    }, 0);

    const sentenceCount = sentenceEntries.length;
    const gaps = sentenceCount > 1 ? safeGap * (sentenceCount - 1) : 0;
    const holds = safeHold * sentenceCount;
    const pauses = safePause * sentenceCount;

    const totalMs = safeIn + typingMs + pauses + holds + gaps + safeOut;
    if (!Number.isFinite(totalMs) || totalMs <= 0) {
      return 0;
    }

    return totalMs / 1000;
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

  const getPlaybackStartIndex = (activeIndex, totalNodes) => {
    const total = Number.isFinite(totalNodes) ? totalNodes : 0;
    if (total <= 0) {
      return -1;
    }

    if (!Number.isFinite(activeIndex) || activeIndex < 0 || activeIndex >= total) {
      return 0;
    }

    return activeIndex;
  };

  const resolvePlaybackScope = (selectedIndex, totalNodes) => {
    const total = Number.isFinite(totalNodes) ? totalNodes : 0;
    if (total <= 0) {
      return { mode: "empty", startIndex: -1 };
    }

    if (Number.isFinite(selectedIndex) && selectedIndex >= 0 && selectedIndex < total) {
      return { mode: "node", startIndex: selectedIndex };
    }

    return { mode: "timeline", startIndex: 0 };
  };

  const buildNodeDescriptor = (node) => {
    const text = node && node.text ? String(node.text) : "";
    const parsed = parseNodeText(text);
    const baseUrl = parsed.baseUrl || "";
    const baseKind = baseUrl ? classifyUrl(baseUrl) : "unknown";
    const overlays = [];
    const ambient = [];

    parsed.layers.forEach((url) => {
      const kind = classifyUrl(url);
      if (kind === "audio") {
        ambient.push({ url, kind });
        return;
      }
      overlays.push({ url, kind });
    });

    return {
      id: node && node.id ? node.id : "",
      text,
      durationOverride: node && node.durationOverride ? node.durationOverride : "",
      base: { url: baseUrl, kind: baseKind },
      overlays,
      ambient
    };
  };

  const buildTimelineDescriptor = (timeline) => {
    const safeTimeline = timeline || { nodes: [], activeIndex: 0 };
    const nodes = Array.isArray(safeTimeline.nodes) ? safeTimeline.nodes : [];
    const activeIndex = Number.isFinite(safeTimeline.activeIndex) ? safeTimeline.activeIndex : 0;

    return {
      version: Number.isFinite(safeTimeline.version) ? safeTimeline.version : 1,
      activeIndex,
      nodes,
      nodesStructured: nodes.map((node) => buildNodeDescriptor(node))
    };
  };

  const buildTimelinePlayerUrl = ({
    origin,
    timeline,
    name,
    autoplay = true,
    hud = false
  } = {}) => {
    if (!origin) {
      return "";
    }

    const payload = encodeTimelinePayload(
      buildTimelineDescriptor(timeline || { version: 1, nodes: [], activeIndex: 0 })
    );
    if (!payload) {
      return "";
    }

    let url;
    try {
      url = new URL("/program-monitor/timeline_player.html", origin);
    } catch (error) {
      return "";
    }

    url.searchParams.set("data", payload);
    if (name) {
      url.searchParams.set("name", name);
    }
    url.searchParams.set("autoplay", autoplay ? "1" : "0");
    url.searchParams.set("hud", hud ? "1" : "0");

    return url.toString();
  };

  const encodeTimelinePayload = (payload) => {
    if (payload === undefined) {
      return "";
    }
    try {
      const json = JSON.stringify(payload);
      if (typeof Buffer !== "undefined") {
        return Buffer.from(json, "utf8").toString("base64");
      }
      if (typeof window !== "undefined" && typeof window.btoa === "function") {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(json);
        let binary = "";
        bytes.forEach((value) => {
          binary += String.fromCharCode(value);
        });
        return window.btoa(binary);
      }
      return "";
    } catch (error) {
      return "";
    }
  };

  const decodeTimelinePayload = (value) => {
    if (!value) {
      return null;
    }
    try {
      let json = "";
      if (typeof Buffer !== "undefined") {
        json = Buffer.from(value, "base64").toString("utf8");
      } else if (typeof window !== "undefined" && typeof window.atob === "function") {
        const binary = window.atob(value);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const decoder = new TextDecoder("utf-8");
        json = decoder.decode(bytes);
      }
      return json ? JSON.parse(json) : null;
    } catch (error) {
      return null;
    }
  };

  return {
    STORAGE_KEY,
    parseNodeText,
    getDurationHintSeconds,
    classifyUrl,
    isHttpUrl,
    uuid,
    getPlaybackStartIndex,
    resolvePlaybackScope,
    buildNodeDescriptor,
    buildTimelineDescriptor,
    buildTimelinePlayerUrl,
    encodeTimelinePayload,
    decodeTimelinePayload
  };
})();

const programMonitorUtils = window.ProgramMonitorUtils || fallbackUtils;
const {
  classifyUrl,
  getDurationHintSeconds,
  getPlaybackStartIndex,
  isHttpUrl,
  parseNodeText,
  buildNodeDescriptor,
  buildTimelineDescriptor,
  buildTimelinePlayerUrl,
  encodeTimelinePayload,
  resolvePlaybackScope,
  STORAGE_KEY,
  uuid
} = programMonitorUtils;

const $ = (selector) => document.querySelector(selector);

const state = {
  nodes: [{ id: uuid(), text: "", durationOverride: "" }],
  activeIndex: 0,
  selectedIndex: null,
  playing: false,
  stopRequested: false,
  pausedAt: 0,
  basePausedAt: 0,
  validationResults: [],
  durationInfo: { duration: 0, source: "none" }
};

const PROJECTS_KEY = "program-monitor.projects.v1";
const PROJECTS_LIMIT = 20;
const OBS_SETTINGS_KEY = "program-monitor.obs.v1";

const elements = {
  nodeList: $("#nodeList"),
  baseVideo: $("#baseVideo"),
  baseImage: $("#baseImage"),
  baseFrame: $("#baseFrame"),
  overlayLayer: $("#overlayLayer"),
  statNode: $("#statNode"),
  statTotal: $("#statTotal"),
  statT: $("#statT"),
  statDur: $("#statDur"),
  statMode: $("#statMode"),
  statDurSource: $("#statDurSource"),
  fileImport: $("#fileImport"),
  message: $("#message"),
  exportStatus: $("#exportStatus"),
  downloadLink: $("#downloadLink"),
  togglePreview: $("#btnTogglePreview"),
  projectToolbar: $("#projectToolbar"),
  projectName: $("#projectName"),
  projectList: $("#projectList"),
  projectsToggle: $("#btnProjects"),
  projectSave: $("#projectSave"),
  openStage: $("#btnOpenStage"),
  obsAddress: $("#obsAddress"),
  obsPassword: $("#obsPassword"),
  obsScene: $("#obsScene"),
  obsInput: $("#obsInput"),
  obsTakeScene: $("#obsTakeScene"),
  obsAutoplay: $("#obsAutoplay"),
  obsHud: $("#obsHud"),
  obsSendTimeline: $("#btnSendTimelineObs"),
  obsToggle: $("#btnToggleObs"),
  obsPanelBody: $("#obsPanelBody")
};

let overlayVideos = [];
let overlayAudios = [];
let rafId = null;
let baseEndedHandler = null;
let exportPollTimer = null;
let activeBaseKind = "video";
let baseStartTime = 0;
const PREVIEW_COLLAPSE_KEY = "program-monitor.preview-collapsed";
const OBS_PANEL_COLLAPSE_KEY = "program-monitor.obs-collapsed";

const isFileProtocol = window.location.protocol === "file:";
const host = window.location.hostname || "localhost";
const renderApiPort = 8793;
const webPort = window.location.port || 8789;
const renderApiBase = `http://${host}:${renderApiPort}`;
const downloadBase = `http://${host}:${webPort}`;
const DEFAULT_IMAGE_DURATION_SECONDS = 5;
const DELETE_LONG_PRESS_MS = 3500;

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

function getSelectedIndex() {
  return Number.isFinite(state.selectedIndex) ? state.selectedIndex : null;
}

function getPlaybackModeLabel() {
  const isSelected = getSelectedIndex() !== null;
  return isSelected ? "Selected Node" : "All Nodes";
}

function getDurationSourceLabel(source) {
  switch (source) {
    case "override":
      return "override";
    case "base":
      return "media";
    case "hint":
      return "url hint";
    case "default":
      return "default";
    default:
      return "auto";
  }
}

function updateStatusDisplay() {
  const selectedIndex = getSelectedIndex();
  const modeLabel = getPlaybackModeLabel();
  const modeText = state.playing ? `${modeLabel} (playing)` : `${modeLabel} (stopped)`;
  const displayIndex = state.playing
    ? state.activeIndex
    : (selectedIndex !== null ? selectedIndex : null);

  elements.statNode.textContent = displayIndex !== null ? String(displayIndex + 1) : "—";
  if (elements.statMode) {
    elements.statMode.textContent = modeText;
  }
  if (elements.statDurSource) {
    elements.statDurSource.textContent = getDurationSourceLabel(state.durationInfo?.source);
  }
}

function buildStagePreviewUrl(timeline, name) {
  if (!encodeTimelinePayload) {
    setMessage("Stage preview encoding is unavailable.");
    return "";
  }
  const payload = buildTimelineDescriptor(
    timeline || {
      version: 1,
      nodes: state.nodes,
      activeIndex: state.activeIndex
    }
  );
  const encoded = encodeTimelinePayload(payload);
  if (!encoded) {
    setMessage("Failed to encode timeline for stage preview.");
    return "";
  }
  const url = new URL("/program-monitor/staged-preview.html", window.location.origin);
  url.searchParams.set("data", encoded);
  if (name) {
    url.searchParams.set("name", name);
  }
  return url.toString();
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

function setObsPanelCollapsed(collapsed) {
  const isCollapsed = Boolean(collapsed);
  if (elements.obsPanelBody) {
    elements.obsPanelBody.setAttribute("aria-hidden", String(isCollapsed));
  }
  if (elements.obsToggle) {
    elements.obsToggle.setAttribute("aria-expanded", String(!isCollapsed));
    elements.obsToggle.textContent = isCollapsed ? "Show OBS" : "Hide OBS";
  }
  try {
    localStorage.setItem(OBS_PANEL_COLLAPSE_KEY, JSON.stringify(isCollapsed));
  } catch (error) {
    console.warn("Failed to persist OBS panel state", error);
  }
}

function saveLocal() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(buildTimelineDescriptor({
        version: 1,
        nodes: state.nodes,
        activeIndex: state.activeIndex
      }))
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
      const storedIndex = Number.isFinite(parsed.activeIndex) ? parsed.activeIndex : 0;
      if (storedIndex === -1) {
        state.activeIndex = -1;
      } else {
        state.activeIndex = Math.min(Math.max(storedIndex, 0), state.nodes.length - 1);
      }
      state.selectedIndex = null;
    }
  } catch (error) {
    console.warn("Failed to load saved timeline", error);
  }
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return entries
      .filter((entry) => entry && entry.name && entry.timeline && Array.isArray(entry.timeline.nodes))
      .map((entry) => ({
        ...entry,
        timeline: buildTimelineDescriptor(entry.timeline),
        id: entry.id || uuid()
      }));
  } catch (error) {
    console.warn("Failed to load saved projects", error);
    return [];
  }
}

function saveProjects(entries) {
  const index = entries.reduce((acc, entry) => {
    if (entry && entry.name) {
      acc[entry.name] = entry.id || "";
    }
    return acc;
  }, {});
  try {
    localStorage.setItem(
      PROJECTS_KEY,
      JSON.stringify({
        version: 1,
        entries,
        index
      })
    );
  } catch (error) {
    console.warn("Failed to save projects", error);
  }
}

function getDefaultObsSettings() {
  return {
    address: `ws://${host}:4455`,
    password: "",
    sceneName: "ASSET_SCENE",
    inputName: "ASSET_MEDIA",
    takeScene: false,
    autoplay: true,
    hud: false
  };
}

function loadObsSettings() {
  try {
    const raw = localStorage.getItem(OBS_SETTINGS_KEY);
    if (!raw) {
      return getDefaultObsSettings();
    }
    const parsed = JSON.parse(raw);
    return {
      ...getDefaultObsSettings(),
      ...parsed
    };
  } catch (error) {
    console.warn("Failed to load OBS settings", error);
    return getDefaultObsSettings();
  }
}

function saveObsSettings(settings) {
  try {
    localStorage.setItem(OBS_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Failed to save OBS settings", error);
  }
}

function applyObsSettingsToInputs(settings) {
  if (!settings) {
    return;
  }
  if (elements.obsAddress) {
    elements.obsAddress.value = settings.address || "";
  }
  if (elements.obsPassword) {
    elements.obsPassword.value = settings.password || "";
  }
  if (elements.obsScene) {
    elements.obsScene.value = settings.sceneName || "";
  }
  if (elements.obsInput) {
    elements.obsInput.value = settings.inputName || "";
  }
  if (elements.obsTakeScene) {
    elements.obsTakeScene.checked = Boolean(settings.takeScene);
  }
  if (elements.obsAutoplay) {
    elements.obsAutoplay.checked = settings.autoplay !== false;
  }
  if (elements.obsHud) {
    elements.obsHud.checked = Boolean(settings.hud);
  }
}

function readObsSettingsFromInputs() {
  return {
    address: elements.obsAddress ? elements.obsAddress.value.trim() : "",
    password: elements.obsPassword ? elements.obsPassword.value : "",
    sceneName: elements.obsScene ? elements.obsScene.value.trim() : "",
    inputName: elements.obsInput ? elements.obsInput.value.trim() : "",
    takeScene: elements.obsTakeScene ? elements.obsTakeScene.checked : false,
    autoplay: elements.obsAutoplay ? elements.obsAutoplay.checked : true,
    hud: elements.obsHud ? elements.obsHud.checked : false
  };
}

function persistObsSettingsFromInputs() {
  const settings = readObsSettingsFromInputs();
  saveObsSettings(settings);
  return settings;
}

function setProjectToolbarOpen(isOpen) {
  const open = Boolean(isOpen);
  if (elements.projectToolbar) {
    elements.projectToolbar.classList.toggle("hidden", !open);
    elements.projectToolbar.setAttribute("aria-hidden", String(!open));
  }
  if (elements.projectsToggle) {
    elements.projectsToggle.setAttribute("aria-expanded", String(open));
  }
}

function renderProjects() {
  if (!elements.projectList) {
    return;
  }
  const entries = loadProjects();
  elements.projectList.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "projectItem";
    empty.innerHTML = `<div class=\"projectItemName\">No saved projects yet.</div>`;
    elements.projectList.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "projectItem";

    const name = document.createElement("div");
    name.className = "projectItemName";
    name.textContent = entry.name;
    name.title = "Click to load this project";
    name.addEventListener("click", async () => {
      const timeline = entry.timeline;
      if (!timeline || !Array.isArray(timeline.nodes) || !timeline.nodes.length) {
        setMessage("Saved project is empty.");
        return;
      }
      state.nodes = timeline.nodes;
      state.activeIndex = Number.isFinite(timeline.activeIndex) ? timeline.activeIndex : 0;
      state.selectedIndex = null;
      state.validationResults = [];
      renderNodes();
      await primeNode(state.activeIndex);
      saveLocal();
      if (elements.projectName) {
        elements.projectName.value = entry.name;
      }
      setMessage(`Loaded project: ${entry.name}`);
    });

    const actions = document.createElement("div");
    actions.className = "projectActions";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", async () => {
      const timeline = entry.timeline;
      if (!timeline || !Array.isArray(timeline.nodes) || !timeline.nodes.length) {
        setMessage("Saved project is empty.");
        return;
      }
      state.nodes = timeline.nodes;
      state.activeIndex = Number.isFinite(timeline.activeIndex) ? timeline.activeIndex : 0;
      state.selectedIndex = null;
      state.validationResults = [];
      renderNodes();
      await primeNode(state.activeIndex);
      saveLocal();
      if (elements.projectName) {
        elements.projectName.value = entry.name;
      }
      setMessage(`Loaded project: ${entry.name}`);
    });

    const stageBtn = document.createElement("button");
    stageBtn.type = "button";
    stageBtn.textContent = "Open Stage";
    stageBtn.addEventListener("click", () => {
      const url = buildStagePreviewUrl(entry.timeline, entry.name);
      if (url) {
        window.open(url, "_blank", "noopener");
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      const next = loadProjects().filter((itemEntry) => itemEntry.name !== entry.name);
      saveProjects(next);
      renderProjects();
    });

    actions.appendChild(loadBtn);
    actions.appendChild(stageBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(name);
    item.appendChild(actions);

    elements.projectList.appendChild(item);
  });
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
  state.selectedIndex = null;
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
  const selectedIndex = getSelectedIndex();

  state.nodes.forEach((node, index) => {
    const card = document.createElement("div");
    const isSelected = selectedIndex !== null && index === selectedIndex;
    const isPlayingAll = state.playing && selectedIndex === null && index === state.activeIndex;
    const classes = ["nodeCard"];
    if (isSelected) {
      classes.push("selected");
    }
    if (isPlayingAll) {
      classes.push("playing-all");
    }
    card.className = classes.join(" ");

    const header = document.createElement("div");
    header.className = "nodeHdr";
    let statusText = "tap to select";
    if (isPlayingAll) {
      statusText = "PLAYING ALL";
    } else if (isSelected && state.playing) {
      statusText = "PLAYING NODE";
    } else if (isSelected) {
      statusText = "SELECTED";
    }
    header.innerHTML = `
      <div class="idx">Node ${index + 1}</div>
      <div class="mini">${statusText}</div>
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

    textarea.addEventListener("input", () => {
      node.text = textarea.value;
      autogrow(textarea);
      saveLocal();
      state.validationResults = [];
      if (!state.playing && index === state.activeIndex) {
        primeNode(index).catch(() => {});
      }
    });

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
    durationInput.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    durationInput.addEventListener("touchstart", (event) => {
      event.stopPropagation();
    });

    card.addEventListener("click", async (event) => {
      event.stopPropagation();
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
    hint.textContent = "Base line = duration source (line 1, or prefix with base:). Remaining lines = layers that loop & clip to base.";

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

  updateStatusDisplay();
}

function clearSelection({ resetActive = false } = {}) {
  if (state.playing) {
    return;
  }
  state.selectedIndex = null;
  if (resetActive) {
    state.activeIndex = state.nodes.length ? 0 : -1;
  }
  renderNodes();
  saveLocal();
  if (state.nodes.length && state.activeIndex >= 0) {
    primeNode(state.activeIndex).catch(() => {});
  } else {
    state.durationInfo = { duration: 0, source: "none" };
    elements.statDur.textContent = "0.00";
    updateStatusDisplay();
  }
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
  if (kind === "page" || kind === "image") {
    elements.baseVideo.pause();
    elements.baseVideo.removeAttribute("src");
    elements.baseVideo.style.display = "none";
    if (kind === "image") {
      elements.baseFrame.style.display = "none";
      elements.baseFrame.removeAttribute("src");
      elements.baseImage.style.display = "block";
      elements.baseImage.src = url || "";
    } else {
      elements.baseImage.style.display = "none";
      elements.baseImage.removeAttribute("src");
      elements.baseFrame.style.display = "block";
      elements.baseFrame.src = url || "about:blank";
    }
  } else {
    elements.baseFrame.removeAttribute("src");
    elements.baseFrame.style.display = "none";
    elements.baseImage.removeAttribute("src");
    elements.baseImage.style.display = "none";
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

function resolveDurationInfo({ baseKind, baseUrl, overrideSeconds, baseDuration, durationHintSeconds }) {
  const override = Number.isFinite(overrideSeconds) && overrideSeconds > 0 ? overrideSeconds : 0;
  const base = Number.isFinite(baseDuration) && baseDuration > 0 ? baseDuration : 0;
  const hintValue = Number.isFinite(durationHintSeconds) ? durationHintSeconds : getDurationHintSeconds(baseUrl);
  const hint = Number.isFinite(hintValue) && hintValue > 0 ? hintValue : 0;

  if (baseKind === "image") {
    if (override) {
      return { duration: override, source: "override" };
    }
    return { duration: DEFAULT_IMAGE_DURATION_SECONDS, source: "default" };
  }

  if (baseKind === "page") {
    if (override) {
      return { duration: override, source: "override" };
    }
    if (hint) {
      return { duration: hint, source: "hint" };
    }
    return { duration: 0, source: "none" };
  }

  if (override) {
    return { duration: override, source: "override" };
  }
  if (base) {
    return { duration: base, source: "base" };
  }
  if (hint) {
    return { duration: hint, source: "hint" };
  }
  return { duration: 0, source: "none" };
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
  if (!node) {
    setBaseKind("video");
    elements.baseVideo.removeAttribute("src");
    elements.baseFrame.removeAttribute("src");
    elements.statDur.textContent = "0.00";
    state.durationInfo = { duration: 0, source: "none" };
    updateStatusDisplay();
    return;
  }
  const parsed = parseNodeText(node.text);
  const overrideSeconds = Number(node.durationOverride);
  const baseKind = classifyUrl(parsed.baseUrl);
  const durationHintSeconds = getDurationHintSeconds(parsed.baseUrl);

  setMessage("");

  if (!parsed.baseUrl) {
    setBaseKind("video");
    elements.baseVideo.removeAttribute("src");
    elements.baseImage.removeAttribute("src");
    elements.baseFrame.removeAttribute("src");
    elements.statDur.textContent = "0.00";
    state.durationInfo = { duration: 0, source: "none" };
    updateStatusDisplay();
    return;
  }

  if (baseKind === "page" || baseKind === "image") {
    setBaseKind(baseKind, parsed.baseUrl);
  } else {
    setBaseKind("video", parsed.baseUrl);
  }

  let duration = 0;
  if (baseKind === "page" || baseKind === "image") {
    if (Number.isFinite(overrideSeconds) && overrideSeconds > 0) {
      duration = overrideSeconds;
      setMessage(`Using duration override for ${baseKind === "page" ? "HTML" : "image"} source.`);
    } else if (baseKind === "page" && Number.isFinite(durationHintSeconds) && durationHintSeconds > 0) {
      duration = durationHintSeconds;
      setMessage("Using duration hint from URL parameters.");
    } else if (baseKind === "image") {
      duration = DEFAULT_IMAGE_DURATION_SECONDS;
      setMessage("Using default image duration.");
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

  const durationInfo = resolveDurationInfo({
    baseKind,
    baseUrl: parsed.baseUrl,
    overrideSeconds,
    baseDuration: duration,
    durationHintSeconds
  });

  duration = durationInfo.duration;
  state.durationInfo = durationInfo;

  if (!duration && baseKind !== "page" && baseKind !== "image") {
    if (Number.isFinite(overrideSeconds) && overrideSeconds > 0) {
      setMessage("Using duration override for streaming source.");
    } else if (Number.isFinite(durationHintSeconds) && durationHintSeconds > 0) {
      setMessage("Using duration hint from URL parameters.");
    } else {
      setMessage("Base duration unknown. Add a duration override to enable playback.");
    }
  }

  elements.statDur.textContent = duration.toFixed(2);
  updateStatusDisplay();

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
  state.pausedAt = 0;
  state.basePausedAt = 0;
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
  state.durationInfo = { duration: 0, source: "none" };
  elements.statDur.textContent = "0.00";
  state.selectedIndex = null;
  state.activeIndex = state.nodes.length ? 0 : -1;
  renderNodes();
  saveLocal();
  if (state.nodes.length && state.activeIndex >= 0) {
    primeNode(state.activeIndex).catch(() => {});
  } else {
    updateStatusDisplay();
  }
}

function clearNodeContent(node) {
  if (!node) {
    return;
  }
  node.text = "";
  node.durationOverride = "";
}

function resetAllNodes() {
  state.nodes = [{ id: uuid(), text: "", durationOverride: "" }];
  state.activeIndex = 0;
  state.selectedIndex = 0;
  state.validationResults = [];
  state.pausedAt = 0;
  state.basePausedAt = 0;
  renderNodes();
  primeNode(state.activeIndex).catch(() => {});
  saveLocal();
  setMessage("Cleared all nodes.");
}

function getBaseElapsed() {
  if (activeBaseKind === "page" || activeBaseKind === "image") {
    return state.basePausedAt || (performance.now() - baseStartTime) / 1000;
  }
  return elements.baseVideo.currentTime || 0;
}

function syncOverlayPlayback(elapsedSeconds, shouldPlay) {
  overlayVideos.forEach((video) => {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    video.currentTime = duration ? elapsedSeconds % duration : elapsedSeconds;
    if (shouldPlay) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });

  overlayAudios.forEach((audio) => {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    audio.currentTime = duration ? elapsedSeconds % duration : elapsedSeconds;
    if (shouldPlay) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  });
}

function pauseAll() {
  if (!state.playing) {
    return;
  }
  state.playing = false;
  state.pausedAt = Number(elements.statT?.textContent || 0) || 0;
  state.basePausedAt = getBaseElapsed();
  elements.baseVideo.pause();
  syncOverlayPlayback(state.basePausedAt, false);
  updateStatusDisplay();
}

async function playActive({ resume = false, startOffsetSeconds = 0 } = {}) {
  state.stopRequested = false;
  state.playing = true;
  if (!resume) {
    state.pausedAt = 0;
    state.basePausedAt = 0;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const selectedIndex = getSelectedIndex();
  const playbackScope = resolvePlaybackScope(selectedIndex, state.nodes.length);
  let startIndex = playbackScope.startIndex;
  if (resume && playbackScope.mode === "timeline") {
    const hasActive = Number.isFinite(state.activeIndex)
      && state.activeIndex >= 0
      && state.activeIndex < state.nodes.length;
    if (hasActive) {
      startIndex = state.activeIndex;
    }
  }
  if (startIndex === -1) {
    state.playing = false;
    setMessage("Add at least one node before playing.");
    updateStatusDisplay();
    return;
  }

  state.activeIndex = startIndex;
  renderNodes();
  saveLocal();
  setMessage(playbackScope.mode === "node" ? "Playing selected node." : "Playing full timeline.");

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
  const safeOffset = Math.max(0, startOffsetSeconds);
  baseStartTime = performance.now() - safeOffset * 1000;

  syncOverlayPlayback(safeOffset, true);

  if (baseKind !== "page" && baseKind !== "image") {
    elements.baseVideo.currentTime = safeOffset;
    await elements.baseVideo.play().catch(() => {
      state.playing = false;
    });
  }

  const playSingle = playbackScope.mode === "node";
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
      updateStatusDisplay();
      return;
    }

    if (playSingle) {
      state.playing = false;
      updateStatusDisplay();
      return;
    }

    if (state.activeIndex < state.nodes.length - 1) {
      state.activeIndex += 1;
      renderNodes();
      playActive({ resume: false, startOffsetSeconds: 0 }).catch(() => {});
    } else {
      state.playing = false;
      setMessage("Reached end of timeline.");
      updateStatusDisplay();
    }
  };

  clearBaseHandlers();
  if (baseKind !== "page" && baseKind !== "image") {
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

    const current = activeBaseKind === "page" || activeBaseKind === "image"
      ? (performance.now() - baseStartTime) / 1000
      : (elements.baseVideo.currentTime || 0);
    const durationInfo = state.durationInfo || { duration: 0, source: "none" };
    const duration = Number.isFinite(durationInfo.duration) ? durationInfo.duration : 0;
    elements.statT.textContent = current.toFixed(2);
    elements.statDur.textContent = (Number.isFinite(duration) ? duration : 0).toFixed(2);

    const shouldAdvanceOnDuration = duration > 0
      && (activeBaseKind === "page" || activeBaseKind === "image" || durationInfo.source === "override");

    if (shouldAdvanceOnDuration && current >= duration - 0.05) {
      advance();
      return;
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

function openBaseInNewTab() {
  const selectedIndex = getSelectedIndex();
  const index = selectedIndex !== null ? selectedIndex : state.activeIndex;
  const node = state.nodes[index];
  if (!node) {
    setMessage("No node selected.");
    return;
  }
  const parsed = parseNodeText(node.text);
  if (!parsed.baseUrl) {
    setMessage("No base URL set for this node.");
    return;
  }
  window.open(parsed.baseUrl, "_blank", "noopener");
}

function saveProject() {
  const rawName = elements.projectName ? elements.projectName.value : "";
  const name = (rawName || "").trim();
  if (!name) {
    setMessage("Name the project before saving.");
    return;
  }

  const timeline = buildTimelineDescriptor({
    version: 1,
    nodes: state.nodes,
    activeIndex: state.activeIndex
  });

  const existing = loadProjects();
  const current = existing.find((entry) => entry.name === name);
  const entries = existing.filter((entry) => entry.name !== name);
  entries.unshift({
    id: current ? current.id : uuid(),
    name,
    savedAt: Date.now(),
    timeline
  });

  const trimmed = entries.slice(0, PROJECTS_LIMIT);
  saveProjects(trimmed);
  renderProjects();
  setMessage(`Saved project: ${name}`);
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

const obsAuth = window.ProgramMonitorObsAuth || {};

function connectObs(settings) {
  if (!settings?.address) {
    return Promise.reject(new Error("OBS WebSocket address is missing."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const pending = new Map();

    let socket;
    try {
      socket = new WebSocket(settings.address, "obswebsocket.json");
    } catch (error) {
      reject(error);
      return;
    }

    const cleanup = () => {
      if (!socket) {
        return;
      }
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (client) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(client);
    };

    const call = (requestType, requestData) => new Promise((resolveCall, rejectCall) => {
      const requestId = uuid();
      pending.set(requestId, { resolveCall, rejectCall });
      socket.send(JSON.stringify({
        op: 6,
        d: {
          requestType,
          requestId,
          requestData
        }
      }));
    });

    const onMessage = async (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (data.op === 0) {
        const auth = data.d?.authentication;
        let authentication = undefined;
        if (auth?.challenge && auth?.salt) {
          if (!settings.password) {
            fail(new Error("OBS WebSocket requires a password."));
            return;
          }
          try {
            if (typeof obsAuth.buildObsAuth !== "function") {
              fail(new Error("OBS auth helper is unavailable. Reload to retry."));
              return;
            }
            authentication = await obsAuth.buildObsAuth(settings.password, auth.challenge, auth.salt);
          } catch (error) {
            fail(new Error("OBS authentication failed."));
            return;
          }
        }

        socket.send(JSON.stringify({
          op: 1,
          d: {
            rpcVersion: data.d?.rpcVersion ?? 1,
            authentication,
            eventSubscriptions: 0
          }
        }));
        return;
      }

      if (data.op === 2) {
        succeed({
          call,
          close: () => {
            cleanup();
            socket.close();
          }
        });
        return;
      }

      if (data.op === 7) {
        const requestId = data.d?.requestId;
        if (!requestId) {
          return;
        }
        const pendingRequest = pending.get(requestId);
        if (!pendingRequest) {
          return;
        }
        pending.delete(requestId);
        if (!data.d?.requestStatus?.result) {
          pendingRequest.rejectCall(new Error(data.d?.requestStatus?.comment || "OBS request failed."));
          return;
        }
        pendingRequest.resolveCall(data.d?.responseData);
      }
    };

    const onError = () => {
      fail(new Error("OBS WebSocket connection error."));
    };

    const onClose = () => {
      if (!settled) {
        fail(new Error("OBS WebSocket closed before identification."));
      }
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

async function sendTimelineToObs() {
  if (isFileProtocol) {
    setMessage("OBS control requires http(s). Serve this page from the stack.");
    return;
  }

  if (!state.nodes.length) {
    setMessage("Add at least one node before sending to OBS.");
    return;
  }

  const settings = persistObsSettingsFromInputs();
  if (!settings.address) {
    setMessage("Set the OBS WebSocket address before connecting.");
    return;
  }
  if (!settings.inputName) {
    setMessage("Set the OBS input name for ASSET_MEDIA.");
    return;
  }

  const origin = window.location.origin;
  if (!origin || origin === "null") {
    setMessage("Unable to resolve the timeline player URL from this origin.");
    return;
  }

  const timeline = {
    version: 1,
    nodes: state.nodes,
    activeIndex: 0
  };
  const name = elements.projectName ? elements.projectName.value.trim() : "";
  const timelineUrl = buildTimelinePlayerUrl({
    origin,
    timeline,
    name,
    autoplay: settings.autoplay,
    hud: settings.hud
  });

  if (!timelineUrl) {
    setMessage("Failed to build the timeline player URL.");
    return;
  }

  setMessage("Connecting to OBS...");

  try {
    const client = await connectObs(settings);
    await client.call("SetInputSettings", {
      inputName: settings.inputName,
      inputSettings: { url: timelineUrl },
      overlay: true
    });

    if (settings.takeScene && settings.sceneName) {
      await client.call("SetCurrentProgramScene", { sceneName: settings.sceneName });
    }

    client.close();
    setMessage("Sent timeline player URL to OBS.");
  } catch (error) {
    console.error(error);
    setMessage(`OBS error: ${error.message || error}`);
  }
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
  primeNode(state.activeIndex).catch(() => {});
  saveLocal();
});

let deleteLongPressTimer = null;
let deleteLongPressTriggered = false;

$("#btnDelete").addEventListener("click", () => {
  if (state.playing) {
    return;
  }
  if (deleteLongPressTriggered) {
    deleteLongPressTriggered = false;
    return;
  }
  if (state.nodes.length <= 1) {
    clearNodeContent(state.nodes[0]);
    state.activeIndex = 0;
    state.selectedIndex = 0;
    state.validationResults = [];
    renderNodes();
    primeNode(state.activeIndex).catch(() => {});
    saveLocal();
    return;
  }
  state.nodes.splice(state.activeIndex, 1);
  state.activeIndex = Math.max(0, state.activeIndex - 1);
  state.selectedIndex = state.nodes.length ? state.activeIndex : null;
  state.validationResults = [];
  renderNodes();
  primeNode(state.activeIndex).catch(() => {});
  saveLocal();
});

const deleteButton = $("#btnDelete");
if (deleteButton) {
  const startLongPress = () => {
    if (state.playing) {
      return;
    }
    deleteLongPressTriggered = false;
    deleteLongPressTimer = setTimeout(() => {
      deleteLongPressTriggered = true;
      resetAllNodes();
    }, DELETE_LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (deleteLongPressTimer) {
      clearTimeout(deleteLongPressTimer);
      deleteLongPressTimer = null;
    }
  };

  deleteButton.addEventListener("mousedown", startLongPress);
  deleteButton.addEventListener("touchstart", startLongPress, { passive: true });
  deleteButton.addEventListener("mouseleave", cancelLongPress);
  deleteButton.addEventListener("mouseup", cancelLongPress);
  deleteButton.addEventListener("touchend", cancelLongPress);
  deleteButton.addEventListener("touchcancel", cancelLongPress);
}

$("#btnPrev").addEventListener("click", async () => {
  if (state.playing) {
    return;
  }
  if (!Number.isFinite(state.activeIndex) || state.activeIndex < 0) {
    state.activeIndex = 0;
  } else {
    state.activeIndex = Math.max(0, state.activeIndex - 1);
  }
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
  if (!Number.isFinite(state.activeIndex) || state.activeIndex < 0) {
    state.activeIndex = 0;
  } else {
    state.activeIndex = Math.min(state.nodes.length - 1, state.activeIndex + 1);
  }
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
  if (state.pausedAt > 0) {
    playActive({ resume: true, startOffsetSeconds: state.basePausedAt }).catch(() => {});
    return;
  }
  playActive({ resume: false, startOffsetSeconds: 0 }).catch(() => {});
});

$("#btnPause").addEventListener("click", () => pauseAll());
$("#btnStop").addEventListener("click", () => stopAll());

$("#btnSave").addEventListener("click", () => saveLocal());
$("#btnExport").addEventListener("click", () => exportJSON());
$("#btnImport").addEventListener("click", () => elements.fileImport.click());
$("#btnValidate").addEventListener("click", () => validateNodes());
$("#btnOpenBase").addEventListener("click", () => openBaseInNewTab());
if (elements.projectSave) {
  elements.projectSave.addEventListener("click", () => saveProject());
}
if (elements.projectsToggle) {
  elements.projectsToggle.addEventListener("click", () => {
    const isHidden = elements.projectToolbar?.classList.contains("hidden");
    setProjectToolbarOpen(isHidden);
    if (isHidden) {
      renderProjects();
    }
  });
}
if (elements.openStage) {
  elements.openStage.addEventListener("click", () => {
    const url = buildStagePreviewUrl();
    if (url) {
      window.open(url, "_blank", "noopener");
    }
  });
}
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

if (elements.obsToggle) {
  elements.obsToggle.addEventListener("click", () => {
    const isCollapsed = elements.obsPanelBody
      ? elements.obsPanelBody.getAttribute("aria-hidden") !== "false"
      : true;
    setObsPanelCollapsed(!isCollapsed);
  });
}

if (elements.nodeList) {
  const nodesPanel = elements.nodeList.closest(".nodes") || elements.nodeList;
  nodesPanel.addEventListener("click", (event) => {
    if (state.playing) {
      return;
    }
    if (event.target.closest(".nodeCard")) {
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

if (elements.obsSendTimeline) {
  elements.obsSendTimeline.addEventListener("click", () => {
    sendTimelineToObs().catch((error) => {
      console.error(error);
    });
  });
}

const obsSettingsInputs = [
  elements.obsAddress,
  elements.obsPassword,
  elements.obsScene,
  elements.obsInput,
  elements.obsTakeScene,
  elements.obsAutoplay,
  elements.obsHud
];

obsSettingsInputs.forEach((input) => {
  if (!input) {
    return;
  }
  input.addEventListener("change", () => {
    persistObsSettingsFromInputs();
  });
});

try {
  const obsSettings = loadObsSettings();
  applyObsSettingsToInputs(obsSettings);
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
  try {
    const storedObs = localStorage.getItem(OBS_PANEL_COLLAPSE_KEY);
    if (storedObs !== null) {
      setObsPanelCollapsed(JSON.parse(storedObs));
    } else {
      setObsPanelCollapsed(true);
    }
  } catch (error) {
    console.warn("Failed to load OBS panel state", error);
    setObsPanelCollapsed(true);
  }
  renderNodes();
  primeNode(state.activeIndex).catch(() => {});
  setExportStatus("Idle");
  setProjectToolbarOpen(false);
  renderProjects();
} catch (error) {
  console.error(error);
  setMessage(`Startup error: ${error?.message || error}`);
}
