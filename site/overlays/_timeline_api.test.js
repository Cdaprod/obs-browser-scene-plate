/**
 * Usage: node --test site/overlays/_timeline_api.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("site/overlays/_timeline_api.js", "utf8");

function createSandbox() {
  const styleMap = new Map();
  const listeners = new Map();

  class CustomEventPolyfill {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const windowObject = {
    document: {
      documentElement: {
        style: {
          setProperty(name, value) {
            styleMap.set(name, value);
          },
          getPropertyValue(name) {
            return styleMap.get(name) || "";
          }
        }
      }
    },
    addEventListener(type, handler) {
      const queue = listeners.get(type) || [];
      queue.push(handler);
      listeners.set(type, queue);
    },
    dispatchEvent(event) {
      const queue = listeners.get(event.type) || [];
      queue.forEach((handler) => handler(event));
      return true;
    },
    CustomEvent: CustomEventPolyfill
  };

  const sandbox = {
    window: windowObject,
    CustomEvent: CustomEventPolyfill
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  return {
    window: sandbox.window,
    styleMap
  };
}

test("setTime clamps and updates css var + getter", () => {
  const sandbox = createSandbox();
  assert.equal(sandbox.window.__TIMELINE__.getTime(), 0);

  sandbox.window.__TIMELINE__.setTime(-5);
  assert.equal(sandbox.window.__TIMELINE__.getTime(), 0);
  assert.equal(sandbox.styleMap.get("--tl-t"), "0");

  sandbox.window.__TIMELINE__.setTime(1.23);
  assert.equal(sandbox.window.__TIMELINE__.getTime(), 1.23);
  assert.equal(sandbox.styleMap.get("--tl-t"), "1.23");
});

test("setTimelineTime delegates to __TIMELINE__.setTime", () => {
  const sandbox = createSandbox();
  sandbox.window.setTimelineTime(2.5);
  assert.equal(sandbox.window.__TIMELINE__.getTime(), 2.5);
});

test("timeline:time event includes detail payload", () => {
  const sandbox = createSandbox();
  let received = null;
  sandbox.window.addEventListener("timeline:time", (event) => {
    received = event.detail;
  });

  sandbox.window.__TIMELINE__.setTime(4.2);
  assert.equal(received && received.t, 4.2);
});

test("existing implementation is not overwritten", () => {
  const existing = {
    setTime(t) {
      return t;
    },
    getTime() {
      return 42;
    }
  };

  const sandbox = {
    window: {
      __TIMELINE__: existing,
      document: { documentElement: { style: { setProperty() {} } } }
    },
    CustomEvent: class CustomEventPolyfill {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  assert.equal(sandbox.window.__TIMELINE__, existing);
  assert.equal(typeof sandbox.window.setTimelineTime, "function");
  assert.equal(sandbox.window.setTimelineTime(7), 7);
});
