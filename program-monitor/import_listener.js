/**
 * Program Monitor import listener.
 * Usage (browser): include /program-monitor/import_listener.js and it will install automatically.
 * Example: window.ProgramMonitorImportListener.installProgramMonitorImportListener();
 * Example payload: { type: "CDAPROD_PROGRAM_MONITOR_IMPORT", version: 1, messageId: "abc", nodes: [{ lines: ["http://..."], durationOverride: "auto" }] }
 */

(function setupProgramMonitorImportListener(globalScope) {
  const ACK_TYPE = "CDAPROD_PROGRAM_MONITOR_ACK";
  const IMPORT_TYPE = "CDAPROD_PROGRAM_MONITOR_IMPORT";
  const IMPORT_VERSION = 1;
  const ALLOWED_ORIGINS = null;
  const DEDUPE_LIMIT = 50;
  const processedMessageIds = [];

  function isAllowedOrigin(origin) {
    if (!ALLOWED_ORIGINS) {
      return true;
    }
    return ALLOWED_ORIGINS.has(origin);
  }

  function normalizeImportNodes(rawNodes) {
    if (!Array.isArray(rawNodes)) {
      return [];
    }

    return rawNodes
      .map((node) => {
        const lines = Array.isArray(node?.lines)
          ? node.lines
            .map((line) => String(line ?? "").trim())
            .filter(Boolean)
          : [];

        if (!lines.length) {
          return null;
        }

        return {
          lines,
          durationOverride: node?.durationOverride ?? "auto"
        };
      })
      .filter(Boolean);
  }

  function shouldApplyDurationOverride(value) {
    if (value === undefined || value === null) {
      return false;
    }
    if (value === "auto" || value === "") {
      return false;
    }
    return true;
  }

  function recordMessageId(messageId) {
    if (!messageId || typeof messageId !== "string") {
      return false;
    }

    const existingIndex = processedMessageIds.indexOf(messageId);
    if (existingIndex !== -1) {
      processedMessageIds.splice(existingIndex, 1);
      processedMessageIds.push(messageId);
      return false;
    }

    processedMessageIds.push(messageId);
    if (processedMessageIds.length > DEDUPE_LIMIT) {
      processedMessageIds.shift();
    }
    return true;
  }

  function wasMessageProcessed(messageId) {
    if (!messageId || typeof messageId !== "string") {
      return false;
    }
    return processedMessageIds.includes(messageId);
  }

  function getCurrentNodeCount() {
    if (!globalScope?.document) {
      return 0;
    }
    return globalScope.document.querySelectorAll(".nodeCard").length;
  }

  function addNode() {
    if (!globalScope?.document) {
      return;
    }
    const button = globalScope.document.querySelector("#btnAdd");
    if (button) {
      button.click();
    }
  }

  function setNodeContent(nodeIndex, lines, durationOverride) {
    if (!globalScope?.document) {
      return;
    }

    const cards = globalScope.document.querySelectorAll(".nodeCard");
    const card = cards[nodeIndex];
    if (!card) {
      return;
    }

    const textarea = card.querySelector("textarea");
    if (textarea) {
      textarea.value = lines.join("\n");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const input = card.querySelector(".nodeDuration input");
    if (!input) {
      return;
    }

    if (shouldApplyDurationOverride(durationOverride)) {
      input.value = String(durationOverride);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function installProgramMonitorImportListener() {
    if (!globalScope?.addEventListener) {
      return;
    }

    globalScope.addEventListener("message", (ev) => {
      if (!isAllowedOrigin(ev.origin)) {
        return;
      }

      const data = ev?.data;
      if (!data || data.type !== IMPORT_TYPE || data.version !== IMPORT_VERSION) {
        return;
      }

      const messageId = typeof data.messageId === "string" ? data.messageId : "";
      const isNewMessage = recordMessageId(messageId);
      if (!isNewMessage && messageId) {
        try {
          ev.source?.postMessage({ type: ACK_TYPE, ok: true, messageId }, ev.origin || "*");
        } catch (error) {
          console.warn("Failed to post import ACK", error);
        }
        return;
      }

      const nodes = normalizeImportNodes(data.nodes);
      if (!nodes.length) {
        return;
      }

      const startIndex = getCurrentNodeCount();
      nodes.forEach((node, offset) => {
        addNode();
        setNodeContent(startIndex + offset, node.lines, node.durationOverride);
      });

      try {
        ev.source?.postMessage({ type: ACK_TYPE, ok: true, messageId }, ev.origin || "*");
      } catch (error) {
        console.warn("Failed to post import ACK", error);
      }
    });
  }

  const api = {
    installProgramMonitorImportListener,
    normalizeImportNodes,
    shouldApplyDurationOverride,
    recordMessageId,
    wasMessageProcessed
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.ProgramMonitorImportListener = api;
  }

  if (globalScope?.document) {
    installProgramMonitorImportListener();
  }
})(typeof window !== "undefined" ? window : globalThis);
