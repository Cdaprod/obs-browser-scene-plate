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

if (typeof window !== "undefined") {
    window.buildFullUrl = buildFullUrl;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildFullUrl, normalizeBaseLocation };
}
