// Her filtre: r/g/b ton eğrileri (5 noktalı), doygunluk, kontrast, parlaklık.
// Not: Bunlar film stoklarının birebir LUT'u değil, görsel olarak yaklaşan tarzlardır.
var ID5 = [0, 0.25, 0.5, 0.75, 1];

var PRESETS = [
  { name: "Clean", tag: "clean",
    r: [0.01,0.25,0.5,0.76,1], g: [0.01,0.25,0.5,0.76,1], b: [0.02,0.26,0.51,0.76,0.99], sat: 1.15, con: 1.06, bri: 1.02 },
  { name: "CineSpace 2383 sRGB", tag: "cinema",
    r: [0.03,0.26,0.53,0.80,0.97], g: [0.02,0.25,0.51,0.77,0.96], b: [0.05,0.25,0.48,0.73,0.92], sat: 1.08, con: 1.08, bri: 1 },
  { name: "Fuji ETERNA 250D · Fuji 3510", tag: "film",
    r: [0.03,0.23,0.49,0.76,0.96], g: [0.03,0.25,0.51,0.77,0.97], b: [0.06,0.27,0.52,0.77,0.96], sat: 0.85, con: 1.02, bri: 1 },
  { name: "Fuji ETERNA 250D · Kodak 2395", tag: "film",
    r: [0.02,0.24,0.51,0.78,0.99], g: [0.03,0.25,0.51,0.77,0.97], b: [0.05,0.26,0.50,0.75,0.94], sat: 0.9, con: 1.05, bri: 1 },
  { name: "Fuji F125 · Kodak 2393", tag: "film",
    r: [0.02,0.25,0.52,0.79,0.98], g: [0.02,0.24,0.50,0.77,0.97], b: [0.04,0.24,0.48,0.73,0.93], sat: 1.0, con: 1.1, bri: 0.99 },
  { name: "Fuji F125 · Kodak 2395", tag: "film",
    r: [0.02,0.26,0.53,0.80,1], g: [0.02,0.24,0.50,0.76,0.97], b: [0.03,0.23,0.47,0.72,0.92], sat: 1.05, con: 1.08, bri: 1 },
  { name: "Fuji REALA 500D · Kodak 2393", tag: "film",
    r: [0.03,0.25,0.51,0.77,0.97], g: [0.03,0.26,0.52,0.78,0.98], b: [0.05,0.26,0.50,0.75,0.95], sat: 0.95, con: 1.04, bri: 1.01 },
  { name: "Kodak 5205 · Fuji 3510", tag: "film",
    r: [0.02,0.25,0.51,0.78,0.99], g: [0.03,0.26,0.52,0.78,0.98], b: [0.04,0.26,0.50,0.76,0.96], sat: 1.12, con: 1.03, bri: 1.01 },
  { name: "Kodak 5218 · Kodak 2383", tag: "film",
    r: [0.04,0.24,0.50,0.77,0.96], g: [0.04,0.26,0.52,0.78,0.97], b: [0.07,0.29,0.55,0.80,0.98], sat: 0.98, con: 1.1, bri: 0.99 },
  { name: "Kodak 5218 · Kodak 2395", tag: "film",
    r: [0.03,0.23,0.49,0.76,0.97], g: [0.03,0.25,0.51,0.77,0.97], b: [0.06,0.28,0.54,0.79,0.98], sat: 1.0, con: 1.06, bri: 1 },
  { name: "SL BIG HDR", tag: "hdr",
    r: [0,0.22,0.5,0.8,1], g: [0,0.22,0.5,0.8,1], b: [0,0.23,0.5,0.79,1], sat: 1.28, con: 1.15, bri: 1.03 },
  { name: "Teal & Orange", tag: "cinema",
    r: [0.0,0.22,0.52,0.82,1], g: [0.02,0.25,0.5,0.75,0.97], b: [0.08,0.3,0.5,0.7,0.88], sat: 1.2, con: 1.1, bri: 1 },
  { name: "Vivid", tr: "Canlı", tag: "color",
    r: ID5, g: ID5, b: ID5, sat: 1.5, con: 1.12, bri: 1.04 },
  { name: "Faded Film", tr: "Soluk Film", tag: "retro",
    r: [0.08,0.3,0.54,0.77,0.95], g: [0.07,0.28,0.52,0.75,0.93], b: [0.1,0.3,0.5,0.72,0.88], sat: 0.75, con: 0.94, bri: 1.02 },
  { name: "Warm Sunset", tr: "Sıcak Gün Batımı", tag: "color",
    r: [0.03,0.29,0.56,0.82,1], g: [0.02,0.25,0.5,0.75,0.95], b: [0.02,0.2,0.43,0.67,0.85], sat: 1.1, con: 1.04, bri: 1.01 },
  { name: "Cold Night", tr: "Soğuk Gece", tag: "color",
    r: [0.0,0.22,0.46,0.71,0.92], g: [0.02,0.25,0.5,0.75,0.97], b: [0.06,0.3,0.56,0.82,1], sat: 0.95, con: 1.08, bri: 0.98 },
  { name: "Sepia", tr: "Sepya", tag: "retro",
    r: [0.05,0.3,0.57,0.83,1], g: [0.03,0.24,0.5,0.75,0.95], b: [0.02,0.17,0.38,0.6,0.8], sat: 0.35, con: 1.05, bri: 1 },
  { name: "Black & White", tr: "Siyah Beyaz", tag: "bw",
    r: ID5, g: ID5, b: ID5, sat: 0, con: 1.15, bri: 1 },
  { name: "High Contrast B&W", tr: "Yüksek Kontrast S/B", tag: "bw",
    r: [0,0.17,0.5,0.85,1], g: [0,0.17,0.5,0.85,1], b: [0,0.17,0.5,0.85,1], sat: 0, con: 1.3, bri: 1 }
];

// ---- Popup ve içerik betiği tarafından paylaşılan yardımcılar ----
function lerp(a, b, t) { return a + (b - a) * t; }

function sampleCurve(table, x) {
  const p = x * (table.length - 1), i = Math.min(Math.floor(p), table.length - 2);
  return lerp(table[i], table[i + 1], p - i);
}

function swatchGradient(p) {            // gri rampın filtreden geçmiş hali
  const stops = [0, 0.25, 0.5, 0.75, 1].map((x) => {
    const c = (t) => Math.round(Math.max(0, Math.min(1, sampleCurve(t, x))) * 255);
    return `rgb(${c(p.r)},${c(p.g)},${c(p.b)})`;
  });
  return `linear-gradient(90deg, ${stops.join(",")})`;
}

function buildConfig(p, k) {            // k: 0..1 yoğunluk
  const mix = (t) => t.map((v, i) => lerp(ID5[i], v, k));
  return { r: mix(p.r), g: mix(p.g), b: mix(p.b), sat: lerp(1, p.sat, k), con: lerp(1, p.con, k), bri: lerp(1, p.bri, k) };
}
