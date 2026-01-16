/**
 * URL helper utilities for OBS Browser Scene Plate.
 * Usage (browser): window.buildFullUrl({ path: "/overlays/foo.html", baseLocation: window.location });
 * Usage (node): const { buildFullUrl } = require("./site/url-utils.js");
 */
function normalizeBaseLocation(baseLocation) {
    if (!baseLocation) {
        throw new Error("normalizeBaseLocation requires a baseLocation");
    }

    if (typeof baseLocation === "string") {
        return new URL(baseLocation);
    }

    if (baseLocation instanceof URL) {
        return baseLocation;
    }

    const origin = baseLocation.origin
        || (baseLocation.protocol && baseLocation.host
            ? `${baseLocation.protocol}//${baseLocation.host}`
            : "");

    const href = baseLocation.href
        || `${origin}${baseLocation.pathname || ""}${baseLocation.search || ""}${baseLocation.hash || ""}`;

    if (!href) {
        throw new Error("normalizeBaseLocation could not resolve href");
    }

    return new URL(href);
}

function buildFullUrl({ path, baseLocation }) {
    if (!path || !baseLocation) {
        throw new Error("buildFullUrl requires a path and baseLocation");
    }

    const baseInfo = normalizeBaseLocation(baseLocation);
    const baseUrl = new URL(path, baseInfo.origin);
    const baseParams = new URLSearchParams(baseInfo.search || "");

    for (const [key, value] of baseParams.entries()) {
        baseUrl.searchParams.append(key, value);
    }

    if (baseInfo.hash && !baseUrl.hash) {
        baseUrl.hash = baseInfo.hash;
    }

    return baseUrl.toString();
}

function extractDefaultUrlFromSource(sourceText) {
    if (!sourceText) {
        return "";
    }

    const lines = sourceText.split(/\r?\n/);
    const urlPattern = /(https?:\/\/\S+|\/\S+)/i;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!/Default URL/i.test(line)) {
            continue;
        }

        const inlineMatch = line.match(/Default URL[^:]*:\s*(\S+)/i);
        if (inlineMatch) {
            return inlineMatch[1];
        }

        for (let j = i + 1; j < Math.min(lines.length, i + 7); j += 1) {
            const cleaned = lines[j]
                .replace(/^\s*(?:\/\/|\/\*+|<!--|\*+)?\s*/g, "")
                .replace(/\s*(?:\*\/|-->).*$/g, "")
                .trim();
            const match = cleaned.match(urlPattern);
            if (match) {
                return match[1];
            }
        }
    }

    return "";
}

function mergeBaseParams({ url, baseLocation }) {
    if (!url || !baseLocation) {
        throw new Error("mergeBaseParams requires a url and baseLocation");
    }

    const baseInfo = normalizeBaseLocation(baseLocation);
    const targetUrl = url instanceof URL ? new URL(url.toString()) : new URL(url, baseInfo.origin);

    for (const [key, value] of baseInfo.searchParams.entries()) {
        if (!targetUrl.searchParams.has(key)) {
            targetUrl.searchParams.append(key, value);
        }
    }

    if (baseInfo.hash && !targetUrl.hash) {
        targetUrl.hash = baseInfo.hash;
    }

    return targetUrl;
}

if (typeof window !== "undefined") {
    window.buildFullUrl = buildFullUrl;
    window.normalizeBaseLocation = normalizeBaseLocation;
    window.extractDefaultUrlFromSource = extractDefaultUrlFromSource;
    window.mergeBaseParams = mergeBaseParams;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        buildFullUrl,
        normalizeBaseLocation,
        extractDefaultUrlFromSource,
        mergeBaseParams
    };
}
