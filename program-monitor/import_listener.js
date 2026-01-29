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

  function getEmptyNodeIndexes(nodeTexts) {
    if (!Array.isArray(nodeTexts)) {
      return [];
    }
    return nodeTexts.reduce((indexes, value, index) => {
      if (!String(value || "").trim()) {
        indexes.push(index);
      }
      return indexes;
    }, []);
  }

  function buildImportPlan(nodeTexts, incomingCount) {
    const emptyIndexes = getEmptyNodeIndexes(nodeTexts);
    const existingIndexes = [];
    let remaining = Number.isFinite(incomingCount) ? incomingCount : 0;
    let emptyCursor = 0;

    while (remaining > 0 && emptyCursor < emptyIndexes.length) {
      existingIndexes.push(emptyIndexes[emptyCursor]);
      emptyCursor += 1;
      remaining -= 1;
    }

    return {
      existingIndexes,
      appendCount: remaining
    };
  }

  function evaluateImportResult(beforeTexts, afterTexts, plan) {
    const beforeCount = Array.isArray(beforeTexts) ? beforeTexts.length : 0;
    const afterCount = Array.isArray(afterTexts) ? afterTexts.length : 0;
    const appendCount = Number.isFinite(plan?.appendCount) ? plan.appendCount : 0;
    const expectedCount = beforeCount + Math.max(0, appendCount);

    if (afterCount < expectedCount) {
      return false;
    }

    const indexes = Array.isArray(plan?.existingIndexes) ? plan.existingIndexes : [];
    return indexes.every((index) => {
      const value = afterTexts[index];
      return Boolean(String(value || "").trim());
    });
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

  function getNodeTextValues() {
    if (!globalScope?.document) {
      return [];
    }
    return Array.from(globalScope.document.querySelectorAll(".nodeCard textarea")).map((textarea) => textarea.value || "");
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

      const nodeTexts = getNodeTextValues();
      const plan = buildImportPlan(nodeTexts, nodes.length);
      const { existingIndexes, appendCount } = plan;
      let appended = 0;

      nodes.forEach((node, index) => {
        if (index < existingIndexes.length) {
          setNodeContent(existingIndexes[index], node.lines, node.durationOverride);
          return;
        }
        addNode();
        setNodeContent(nodeTexts.length + appended, node.lines, node.durationOverride);
        appended += 1;
      });

      const updatedTexts = getNodeTextValues();
      const importSucceeded = evaluateImportResult(nodeTexts, updatedTexts, {
        existingIndexes,
        appendCount
      });

      try {
        ev.source?.postMessage({ type: ACK_TYPE, ok: importSucceeded, messageId }, ev.origin || "*");
      } catch (error) {
        console.warn("Failed to post import ACK", error);
      }
    });
  }

  const api = {
    installProgramMonitorImportListener,
    normalizeImportNodes,
    getEmptyNodeIndexes,
    buildImportPlan,
    evaluateImportResult,
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
