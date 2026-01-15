/**
 * URL helper utilities for OBS Browser Scene Plate.
 * Usage (browser): window.buildFullUrl({ path: "/overlays/foo.html", baseLocation: window.location });
 * Usage (node): const { buildFullUrl } = require("./site/url-utils.js");
 */
function buildFullUrl({ path, baseLocation }) {
    if (!path || !baseLocation) {
        throw new Error("buildFullUrl requires a path and baseLocation");
    }

    const baseUrl = new URL(path, baseLocation.origin);
    const baseParams = new URLSearchParams(baseLocation.search || "");

    for (const [key, value] of baseParams.entries()) {
        if (!baseUrl.searchParams.has(key)) {
            baseUrl.searchParams.append(key, value);
        }
    }

    if (baseLocation.hash && !baseUrl.hash) {
        baseUrl.hash = baseLocation.hash;
    }

    return baseUrl.toString();
}

if (typeof window !== "undefined") {
    window.buildFullUrl = buildFullUrl;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildFullUrl };
}
