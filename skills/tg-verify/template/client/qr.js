// A small QR code encoder (ISO/IEC 18004): byte mode, versions 1-10, error-correction level M — plenty for a t.me link (up to 213
// bytes). Pure: text → a square matrix of booleans → SVG. No dependency, nothing leaves the Worker (no outside QR service sees
// the links). Checked against an independent decoder for every version and mask.

const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];      // level M: error-correction codewords per block, by version
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];                      // level M: number of blocks, by version
const RAW_BITS = [0, 208, 359, 567, 807, 1079, 1383, 1568, 1936, 2336, 2768];
export const MAX_VERSION = 10;

const size = (v) => 17 + 4 * v;
const rawCodewords = (v) => Math.floor(RAW_BITS[v] / 8);
const dataCodewords = (v) => rawCodewords(v) - EC_PER_BLOCK[v] * BLOCKS[v];
const countBits = (v) => (v < 10 ? 8 : 16);

// GF(256) with the QR polynomial x^8+x^4+x^3+x^2+1
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Reed–Solomon remainder of `data` for `n` error-correction codewords. */
function ecc(data, n) {
    let gen = [1];
    for (let i = 0; i < n; i++) { const next = new Array(gen.length + 1).fill(0); for (let j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], EXP[i]); } gen = next; }
    const rem = new Array(n).fill(0);
    for (const b of data) { const f = b ^ rem.shift(); rem.push(0); for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i + 1], f); }
    return rem;
}

/** Centre coordinates of the alignment patterns. */
function alignment(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, last = 4 * v + 10, step = Math.ceil((last - 6) / (n - 1) / 2) * 2, out = [6];
    for (let i = 0; i < n - 1; i++) out.splice(1, 0, last - i * step);
    return out;
}

function codewords(bytes, v) {
    const bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, countBits(v)); for (const b of bytes) put(b, 8);
    const cap = dataCodewords(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    for (let pad = 0xec; data.length < dataCodewords(v); pad ^= 0xec ^ 0x11) data.push(pad);

    const nb = BLOCKS[v], ne = EC_PER_BLOCK[v], raw = rawCodewords(v), short = nb - (raw % nb), len = Math.floor(raw / nb) - ne;
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k + len + (i < short ? 0 : 1)); k += d.length; blocks.push({ d, e: ecc(d, ne) }); }
    const out = [];
    for (let i = 0; i <= len; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    for (let i = 0; i < ne; i++) for (const b of blocks) out.push(b.e[i]);
    return out;
}

const MASKS = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m) {
    const n = m.length; let p = 0, dark = 0;
    const line = (get) => {
        for (let i = 0; i < n; i++) {
            let run = 1, hist = "";
            for (let j = 0; j < n; j++) {
                hist += get(i, j) ? "1" : "0";
                if (j && get(i, j) === get(i, j - 1)) run++; else { if (run >= 5) p += run - 2; run = 1; }
            }
            if (run >= 5) p += run - 2;
            for (const pat of ["10111010000", "00001011101"]) for (let k = hist.indexOf(pat); k >= 0; k = hist.indexOf(pat, k + 1)) p += 40;
        }
    };
    line((i, j) => m[i][j]); line((i, j) => m[j][i]);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (m[r][c]) dark++;
        if (r && c && m[r][c] === m[r - 1][c] && m[r][c] === m[r][c - 1] && m[r][c] === m[r - 1][c - 1]) p += 3;
    }
    return p + Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
}

/** text → matrix of booleans (true = dark). Throws when it doesn't fit version 10. `mask` is only for tests. */
export function qrMatrix(textIn, { mask = null } = {}) {
    const bytes = [...new TextEncoder().encode(String(textIn))];
    let v = 1;
    while (v <= MAX_VERSION && 4 + countBits(v) + bytes.length * 8 > dataCodewords(v) * 8) v++;
    if (v > MAX_VERSION) throw new Error("too long for a QR code");
    const n = size(v), m = Array.from({ length: n }, () => new Array(n).fill(false)), fixed = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (r, c, dark) => { m[r][c] = !!dark; fixed[r][c] = true; };

    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }                                     // timing
    const finder = (r0, c0) => { for (let r = -4; r <= 4; r++) for (let c = -4; c <= 4; c++) { const y = r0 + r, x = c0 + c, d = Math.max(Math.abs(r), Math.abs(c)); if (y >= 0 && y < n && x >= 0 && x < n) set(y, x, d !== 2 && d !== 4); } };
    finder(3, 3); finder(3, n - 4); finder(n - 4, 3);
    const al = alignment(v);
    for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
        for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(al[i] + r, al[j] + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
    const format = (mk) => {
        const d = (0 << 3) | mk; let rem = d;                                                                           // level M = 00
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((d << 10) | rem) ^ 0x5412, b = (i) => (bits >>> i) & 1;
        for (let i = 0; i <= 5; i++) set(i, 8, b(i));
        set(7, 8, b(6)); set(8, 8, b(7)); set(8, 7, b(8));
        for (let i = 9; i < 15; i++) set(8, 14 - i, b(i));
        for (let i = 0; i < 8; i++) set(8, n - 1 - i, b(i));
        for (let i = 8; i < 15; i++) set(n - 15 + i, 8, b(i));
        set(n - 8, 8, 1);
    };
    format(0);
    if (v >= 7) {
        let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const bits = (v << 12) | rem;
        for (let i = 0; i < 18; i++) { const a = n - 11 + (i % 3), b = Math.floor(i / 3), bit = (bits >>> i) & 1; set(a, b, bit); set(b, a, bit); }
    }

    const cw = codewords(bytes, v); let k = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
            const c = right - j, up = ((right + 1) & 2) === 0, r = up ? n - 1 - vert : vert;
            if (!fixed[r][c] && k < cw.length * 8) { m[r][c] = ((cw[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
        }
    }

    const flip = (mk) => { for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fixed[r][c] && MASKS[mk](r, c)) m[r][c] = !m[r][c]; };
    let best = mask;
    if (best == null) {
        let low = Infinity;
        for (let mk = 0; mk < 8; mk++) { flip(mk); format(mk); const p = penalty(m); if (p < low) { low = p; best = mk; } flip(mk); }
    }
    flip(best); format(best);
    return m;
}

/** A scalable, rounded QR as an SVG string (4 modules of quiet zone). Colours are plain hex. */
export function qrSvg(textIn, { px = 512, dark = "#17110f", light = "#ffffff" } = {}) {
    const m = qrMatrix(textIn), n = m.length, q = 4, t = n + q * 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (!m[r][c]) continue;
        let w = 1; while (c + w < n && m[r][c + w]) w++;
        d += `M${c + q} ${r + q}h${w}v1h-${w}z`;
        c += w - 1;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
