/**
 * Basic URL merge tests for site/url-utils.js.
 * Usage: node scripts/test-index-url.cjs
 * Example: node scripts/test-index-url.cjs
 */
const assert = require("assert");
const {
    buildFullUrl,
    normalizeBaseLocation,
    applyBaseToUrl,
    extractDefaultUrlFromSource,
    mergeBaseParams,
    encodeQueryValue,
    decodeQueryValue
} = require("../site/url-utils.js");

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
        "http://example.com:8789/overlays/test.html?bar=9&baz=3&foo=1&bar=2#demo",
        "should preserve existing params and append base params"
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

    const locationLike = {
        protocol: "http:",
        host: "example.com:8789",
        pathname: "/index.html",
        search: "?alpha=1",
        hash: "#hashy"
    };

    const normalized = normalizeBaseLocation(locationLike);
    assert.strictEqual(
        normalized.href,
        "http://example.com:8789/index.html?alpha=1#hashy",
        "should normalize a Location-like object"
    );

    const fromString = buildFullUrl({
        path: "/overlays/extra.html",
        baseLocation: "http://example.com:8789/index.html?beta=2"
    });

    assert.strictEqual(
        fromString,
        "http://example.com:8789/overlays/extra.html?beta=2",
        "should accept string base locations"
    );

    const defaultUrlInline = "<!-- Default URL (full params): http://<HOST_IP>:8789/overlays/demo.html?mode=burst -->";
    assert.strictEqual(
        extractDefaultUrlFromSource(defaultUrlInline),
        "http://<HOST_IP>:8789/overlays/demo.html?mode=burst",
        "should extract inline default URLs"
    );

    const defaultUrlMultiline = `
        /**
         * Default URL (full params):
         *  http://<HOST_IP>:8789/overlays/demo.html?mode=loop&hold=1200
         */
    `;
    assert.strictEqual(
        extractDefaultUrlFromSource(defaultUrlMultiline),
        "http://<HOST_IP>:8789/overlays/demo.html?mode=loop&hold=1200",
        "should extract multiline default URLs"
    );

    const merged = mergeBaseParams({
        url: "http://example.com:8789/overlays/demo.html?mode=loop",
        baseLocation: "http://example.com:8789/index.html?alpha=1#keep"
    });
    assert.strictEqual(
        merged.toString(),
        "http://example.com:8789/overlays/demo.html?mode=loop&alpha=1#keep",
        "should append base params and hash without overriding existing params"
    );

    const appliedBase = applyBaseToUrl({
        url: "http://example.com:8789/overlays/demo.html?mode=loop",
        baseLocation: "https://example.com/index.html"
    });
    assert.strictEqual(
        appliedBase.toString(),
        "https://example.com/overlays/demo.html?mode=loop",
        "should apply base protocol/host and clear non-matching ports"
    );

    assert.strictEqual(
        encodeQueryValue("WORD WORD"),
        "WORD%20WORD",
        "should encode spaces as %20"
    );

    assert.strictEqual(
        encodeQueryValue("a&b=c"),
        "a%26b%3Dc",
        "should encode reserved characters"
    );

    assert.strictEqual(
        decodeQueryValue("WORD%20WORD"),
        "WORD WORD",
        "should decode encoded text"
    );

    assert.strictEqual(
        decodeQueryValue("line1%0Aline2"),
        "line1\nline2",
        "should decode line breaks"
    );

    assert.strictEqual(
        decodeQueryValue("a%2Bb"),
        "a+b",
        "should preserve encoded plus values"
    );

    assert.strictEqual(
        decodeQueryValue("a+b"),
        "a+b",
        "should not coerce literal plus into spaces"
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
