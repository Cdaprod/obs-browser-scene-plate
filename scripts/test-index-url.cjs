/**
 * Basic URL merge tests for site/url-utils.js.
 * Usage: node scripts/test-index-url.cjs
 * Example: node scripts/test-index-url.cjs
 */
const assert = require("assert");
const { buildFullUrl } = require("../site/url-utils.js");

function runTests() {
    const baseLocation = new URL("http://example.com:8789/index.html?foo=1&bar=2#demo");
    const simple = buildFullUrl({
        path: "/overlays/test.html",
        baseLocation
    });

    assert.strictEqual(
        simple,
        "http://example.com:8789/overlays/test.html?foo=1&bar=2#demo",
        "should append base query + hash to simple paths"
    );

    const withQuery = buildFullUrl({
        path: "/overlays/test.html?bar=9&baz=3",
        baseLocation
    });

    assert.strictEqual(
        withQuery,
        "http://example.com:8789/overlays/test.html?bar=9&baz=3&foo=1#demo",
        "should preserve existing params and add missing base params"
    );

    const withHash = buildFullUrl({
        path: "/overlays/test.html#custom",
        baseLocation
    });

    assert.strictEqual(
        withHash,
        "http://example.com:8789/overlays/test.html?foo=1&bar=2#custom",
        "should preserve explicit hash when provided"
    );
}

try {
    runTests();
    console.log("test-index-url: ok");
    process.exit(0);
} catch (error) {
    console.error("test-index-url: failed");
    console.error(error);
    process.exit(1);
}
