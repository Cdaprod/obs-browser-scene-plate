/**
 * Program Monitor OBS auth helpers.
 * Usage (browser): window.ProgramMonitorObsAuth.buildObsAuth(password, challenge, salt)
 * Usage (node): node --test program-monitor/obs-auth.test.mjs
 * Example: ProgramMonitorObsAuth.buildObsAuth("pass", "challenge", "salt");
 */

(function setupProgramMonitorObsAuth(globalScope) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

  function utf8ToBytes(value) {
    if (typeof TextEncoder !== "undefined") {
      return Array.from(new TextEncoder().encode(value));
    }
    const bytes = [];
    for (let i = 0; i < value.length; i += 1) {
      let code = value.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3f));
      } else if (code < 0xd800 || code >= 0xe000) {
        bytes.push(0xe0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      } else {
        i += 1;
        code = 0x10000 + (((code & 0x3ff) << 10) | (value.charCodeAt(i) & 0x3ff));
        bytes.push(0xf0 | (code >> 18));
        bytes.push(0x80 | ((code >> 12) & 0x3f));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      }
    }
    return bytes;
  }

  function sha256Bytes(message) {
    const bytes = utf8ToBytes(message);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) {
      bytes.push(0);
    }

    const high = Math.floor(bitLen / 0x100000000);
    const low = bitLen >>> 0;
    bytes.push((high >>> 24) & 0xff);
    bytes.push((high >>> 16) & 0xff);
    bytes.push((high >>> 8) & 0xff);
    bytes.push(high & 0xff);
    bytes.push((low >>> 24) & 0xff);
    bytes.push((low >>> 16) & 0xff);
    bytes.push((low >>> 8) & 0xff);
    bytes.push(low & 0xff);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i += 1) {
        const idx = offset + i * 4;
        w[i] = ((bytes[idx] << 24) | (bytes[idx + 1] << 16) | (bytes[idx + 2] << 8) | bytes[idx + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i += 1) {
        const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let i = 0; i < 64; i += 1) {
        const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
        const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const temp2 = (s0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    return [
      h0, h1, h2, h3, h4, h5, h6, h7
    ].flatMap((word) => [
      (word >>> 24) & 0xff,
      (word >>> 16) & 0xff,
      (word >>> 8) & 0xff,
      word & 0xff
    ]);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((value) => {
      binary += String.fromCharCode(value);
    });
    if (typeof globalScope?.btoa === "function") {
      return globalScope.btoa(binary);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(binary, "binary").toString("base64");
    }
    return "";
  }

  async function sha256Base64(value, options = {}) {
    if (!value) {
      return "";
    }
    const useWebCrypto = options.useWebCrypto !== false;
    const webCrypto = globalScope?.crypto?.subtle;
    if (useWebCrypto && webCrypto) {
      const data = new TextEncoder().encode(value);
      const hash = await webCrypto.digest("SHA-256", data);
      return bytesToBase64(Array.from(new Uint8Array(hash)));
    }
    return bytesToBase64(sha256Bytes(value));
  }

  async function buildObsAuth(password, challenge, salt, options = {}) {
    if (!password) {
      return "";
    }
    const secret = await sha256Base64(`${password}${salt}`, options);
    return sha256Base64(`${secret}${challenge}`, options);
  }

  const api = {
    sha256Base64,
    buildObsAuth
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ProgramMonitorObsAuth = api;
  }
})(typeof window !== "undefined" ? window : global);
