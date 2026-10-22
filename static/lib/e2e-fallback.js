/* ===================================================================
 * ClipVault E2E Fallback — 纯 JavaScript AES-256-CBC + HMAC-SHA256
 * 
 * 用于浏览器不支持 Web Crypto API 的环境（如 HTTP 页面）。
 * 当 crypto.subtle 不可用时自动启用。
 * 
 * 加密方案：Encrypt-then-MAC
 *   1. 生成随机 256-bit AES 密钥 + 128-bit IV
 *   2. AES-256-CBC 加密（PKCS7 填充）
 *   3. HMAC-SHA256(密文, 密钥) 防篡改
 *   4. 输出格式：iv_b64.ct_b64.mac_b64
 * =================================================================== */

const E2E_FALLBACK = (() => {
  /* ---------- SHA-256 ---------- */
  function sha256(message) {
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

    const msg = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
    const l = msg.length * 8;
    const k = ((msg.length + 9 + 63) >> 6) << 6;
    const padded = new Uint8Array(k);
    padded.set(msg);
    padded[msg.length] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(k - 4, l, false);

    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    for (let i = 0; i < k; i += 64) {
      const W = new Uint32Array(64);
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4, false);
      for (let t = 16; t < 64; t++) {
        const s0 = (rr(W[t - 15], 7) ^ rr(W[t - 15], 18) ^ (W[t - 15] >>> 3));
        const s1 = (rr(W[t - 2], 17) ^ rr(W[t - 2], 19) ^ (W[t - 2] >>> 10));
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h];
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i] & 0xffffffff, false);
    return out;
  }

  function rr(x, n) { return (x >>> n) | (x << (32 - n)); }

  /* ---------- HMAC-SHA256 ---------- */
  function hmacSha256(key, message) {
    const blockSize = 64;
    let k = key;
    if (k.length > blockSize) k = sha256(k);
    if (k.length < blockSize) {
      const tmp = new Uint8Array(blockSize);
      tmp.set(k);
      k = tmp;
    }
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = k[i] ^ 0x36;
      opad[i] = k[i] ^ 0x5c;
    }
    const inner = new Uint8Array(blockSize + message.length);
    inner.set(ipad);
    inner.set(message, blockSize);
    const outer = new Uint8Array(blockSize + 32);
    outer.set(opad);
    outer.set(sha256(inner), blockSize);
    return sha256(outer);
  }

  /* ---------- AES-256 (14 rounds) ---------- */
  const SBOX = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
  ];

  const INV_SBOX = [
    0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
    0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
    0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
    0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
    0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
    0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
    0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
    0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
    0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
    0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
    0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
    0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
    0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
    0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
    0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
    0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d
  ];

  const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d, 0x9a];

  function galoisMul(a, b) {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  }

  function keyExpansion(key) {
    const Nk = 8, Nr = 14;
    const w = new Array(4 * (Nr + 1));
    for (let i = 0; i < Nk; i++) {
      w[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
    }
    for (let i = Nk; i < 4 * (Nr + 1); i++) {
      let temp = w[i - 1];
      if (i % Nk === 0) {
        temp = (SBOX[(temp >>> 16) & 0xff] << 24) | (SBOX[(temp >>> 8) & 0xff] << 16) |
               (SBOX[temp & 0xff] << 8) | SBOX[(temp >>> 24) & 0xff];
        temp ^= RCON[Math.floor(i / Nk) - 1] << 24;
      } else if (Nk > 6 && i % Nk === 4) {
        temp = (SBOX[(temp >>> 24) & 0xff] << 24) | (SBOX[(temp >>> 16) & 0xff] << 16) |
               (SBOX[(temp >>> 8) & 0xff] << 8) | SBOX[temp & 0xff];
      }
      w[i] = w[i - Nk] ^ temp;
    }
    return w;
  }

  function addRoundKey(state, w, round) {
    for (let i = 0; i < 4; i++) {
      const wk = w[round * 4 + i];
      state[i] = ((state[i] >>> 24) ^ ((wk >>> 24) & 0xff)) << 24 |
                 (((state[i] >>> 16) & 0xff) ^ ((wk >>> 16) & 0xff)) << 16 |
                 (((state[i] >>> 8) & 0xff) ^ ((wk >>> 8) & 0xff)) << 8 |
                 ((state[i] & 0xff) ^ (wk & 0xff));
    }
  }

  function subBytes(state) {
    for (let i = 0; i < 4; i++) {
      state[i] = (SBOX[(state[i] >>> 24) & 0xff] << 24) |
                 (SBOX[(state[i] >>> 16) & 0xff] << 16) |
                 (SBOX[(state[i] >>> 8) & 0xff] << 8) |
                 SBOX[state[i] & 0xff];
    }
  }

  function invSubBytes(state) {
    for (let i = 0; i < 4; i++) {
      state[i] = (INV_SBOX[(state[i] >>> 24) & 0xff] << 24) |
                 (INV_SBOX[(state[i] >>> 16) & 0xff] << 16) |
                 (INV_SBOX[(state[i] >>> 8) & 0xff] << 8) |
                 INV_SBOX[state[i] & 0xff];
    }
  }

  function shiftRows(state) {
    const s = [state[0], state[1], state[2], state[3]];
    state[0] = (s[0] & 0xff000000) | (s[1] & 0x00ff0000) | (s[2] & 0x0000ff00) | (s[3] & 0x000000ff);
    state[1] = (s[1] & 0xff000000) | (s[2] & 0x00ff0000) | (s[3] & 0x0000ff00) | (s[0] & 0x000000ff);
    state[2] = (s[2] & 0xff000000) | (s[3] & 0x00ff0000) | (s[0] & 0x0000ff00) | (s[1] & 0x000000ff);
    state[3] = (s[3] & 0xff000000) | (s[0] & 0x00ff0000) | (s[1] & 0x0000ff00) | (s[2] & 0x000000ff);
  }

  function invShiftRows(state) {
    const s = [state[0], state[1], state[2], state[3]];
    state[0] = (s[0] & 0xff000000) | (s[3] & 0x00ff0000) | (s[2] & 0x0000ff00) | (s[1] & 0x000000ff);
    state[1] = (s[1] & 0xff000000) | (s[0] & 0x00ff0000) | (s[3] & 0x0000ff00) | (s[2] & 0x000000ff);
    state[2] = (s[2] & 0xff000000) | (s[1] & 0x00ff0000) | (s[0] & 0x0000ff00) | (s[3] & 0x000000ff);
    state[3] = (s[3] & 0xff000000) | (s[2] & 0x00ff0000) | (s[1] & 0x0000ff00) | (s[0] & 0x000000ff);
  }

  function mixColumns(state) {
    for (let i = 0; i < 4; i++) {
      const a = [(state[i] >>> 24) & 0xff, (state[i] >>> 16) & 0xff, (state[i] >>> 8) & 0xff, state[i] & 0xff];
      state[i] = (galoisMul(a[0], 2) ^ galoisMul(a[1], 3) ^ a[2] ^ a[3]) << 24 |
                 (a[0] ^ galoisMul(a[1], 2) ^ galoisMul(a[2], 3) ^ a[3]) << 16 |
                 (a[0] ^ a[1] ^ galoisMul(a[2], 2) ^ galoisMul(a[3], 3)) << 8 |
                 (galoisMul(a[0], 3) ^ a[1] ^ a[2] ^ galoisMul(a[3], 2));
    }
  }

  function invMixColumns(state) {
    for (let i = 0; i < 4; i++) {
      const a = [(state[i] >>> 24) & 0xff, (state[i] >>> 16) & 0xff, (state[i] >>> 8) & 0xff, state[i] & 0xff];
      state[i] = (galoisMul(a[0], 14) ^ galoisMul(a[1], 11) ^ galoisMul(a[2], 13) ^ galoisMul(a[3], 9)) << 24 |
                 (galoisMul(a[0], 9) ^ galoisMul(a[1], 14) ^ galoisMul(a[2], 11) ^ galoisMul(a[3], 13)) << 16 |
                 (galoisMul(a[0], 13) ^ galoisMul(a[1], 9) ^ galoisMul(a[2], 14) ^ galoisMul(a[3], 11)) << 8 |
                 (galoisMul(a[0], 11) ^ galoisMul(a[1], 13) ^ galoisMul(a[2], 9) ^ galoisMul(a[3], 14));
    }
  }

  function encryptBlock(block, w) {
    const state = [
      (block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3],
      (block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7],
      (block[8] << 24) | (block[9] << 16) | (block[10] << 8) | block[11],
      (block[12] << 24) | (block[13] << 16) | (block[14] << 8) | block[15]
    ];
    addRoundKey(state, w, 0);
    for (let r = 1; r < 14; r++) {
      subBytes(state); shiftRows(state); mixColumns(state); addRoundKey(state, w, r);
    }
    subBytes(state); shiftRows(state); addRoundKey(state, w, 14);
    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
      out[i * 4] = (state[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (state[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (state[i] >>> 8) & 0xff;
      out[i * 4 + 3] = state[i] & 0xff;
    }
    return out;
  }

  function decryptBlock(block, w) {
    const state = [
      (block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3],
      (block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7],
      (block[8] << 24) | (block[9] << 16) | (block[10] << 8) | block[11],
      (block[12] << 24) | (block[13] << 16) | (block[14] << 8) | block[15]
    ];
    addRoundKey(state, w, 14);
    for (let r = 13; r >= 1; r--) {
      invShiftRows(state); invSubBytes(state); addRoundKey(state, w, r); invMixColumns(state);
    }
    invShiftRows(state); invSubBytes(state); addRoundKey(state, w, 0);
    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
      out[i * 4] = (state[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (state[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (state[i] >>> 8) & 0xff;
      out[i * 4 + 3] = state[i] & 0xff;
    }
    return out;
  }

  /* ---------- AES-256-CBC with PKCS7 ---------- */
  function aesCbcEncrypt(plaintextBytes, keyBytes, ivBytes) {
    const w = keyExpansion(keyBytes);
    const padLen = 16 - (plaintextBytes.length % 16);
    const padded = new Uint8Array(plaintextBytes.length + padLen);
    padded.set(plaintextBytes);
    padded.fill(padLen, plaintextBytes.length);

    const result = new Uint8Array(padded.length);
    let prev = new Uint8Array(ivBytes);
    for (let i = 0; i < padded.length; i += 16) {
      const block = new Uint8Array(16);
      for (let j = 0; j < 16; j++) block[j] = padded[i + j] ^ prev[j];
      const enc = encryptBlock(block, w);
      result.set(enc, i);
      prev = enc;
    }
    return result;
  }

  function aesCbcDecrypt(ciphertextBytes, keyBytes, ivBytes) {
    const w = keyExpansion(keyBytes);
    const result = new Uint8Array(ciphertextBytes.length);
    let prev = new Uint8Array(ivBytes);
    for (let i = 0; i < ciphertextBytes.length; i += 16) {
      const dec = decryptBlock(ciphertextBytes.slice(i, i + 16), w);
      for (let j = 0; j < 16; j++) result[i + j] = dec[j] ^ prev[j];
      prev = ciphertextBytes.slice(i, i + 16);
    }
    const padLen = result[result.length - 1];
    if (padLen < 1 || padLen > 16) throw new Error("bad padding");
    return result.slice(0, result.length - padLen);
  }

  /* ---------- Base64 helpers ---------- */
  function bytesToB64(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* ---------- Public API ---------- */
  function randBytes(n) {
    const arr = new Uint8Array(n);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }

  async function encrypt(plaintext) {
    const key = randBytes(32);          // AES-256
    const iv = randBytes(16);           // AES block size
    const ptBytes = new TextEncoder().encode(plaintext);
    const ct = aesCbcEncrypt(ptBytes, key, iv);
    const mac = hmacSha256(key, ct);    // Encrypt-then-MAC
    return {
      payload: bytesToB64(iv) + "." + bytesToB64(ct) + "." + bytesToB64(mac),
      keyB64: bytesToB64(key),
    };
  }

  async function encryptWithKey(plaintext, keyB64) {
    // 用已有密钥加密（例如让标题与正文共用同一把密钥，避免标题明文泄露）
    const key = b64ToBytes(keyB64);
    const iv = randBytes(16);
    const ct = aesCbcEncrypt(new TextEncoder().encode(plaintext), key, iv);
    const mac = hmacSha256(key, ct);
    return bytesToB64(iv) + "." + bytesToB64(ct) + "." + bytesToB64(mac);
  }

  async function decrypt(payload, keyB64) {
    const parts = payload.split(".");
    if (parts.length !== 3) throw new Error("bad payload format");
    const iv = b64ToBytes(parts[0]);
    const ct = b64ToBytes(parts[1]);
    const mac = b64ToBytes(parts[2]);
    const key = b64ToBytes(keyB64);

    // Verify HMAC before decrypting
    const expectedMac = hmacSha256(key, ct);
    for (let i = 0; i < 32; i++) {
      if (mac[i] !== expectedMac[i]) throw new Error("HMAC mismatch — 内容可能被篡改");
    }

    const pt = aesCbcDecrypt(ct, key, iv);
    return new TextDecoder().decode(pt);
  }

  return { encrypt, encryptWithKey, decrypt, randBytes, bytesToB64, b64ToBytes };
})();