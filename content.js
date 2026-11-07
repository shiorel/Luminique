(() => {
  if (window.__vfLoaded) return;
  window.__vfLoaded = true;

  const UID = Math.random().toString(36).slice(2);
  const FID = "__vf_filter__", SVG_ID = "__vf_svg__", SVGNS = "http://www.w3.org/2000/svg";
  const DEFAULT = () => ({ index: -1, amount: 100, up: { on: false, sharp: 50 }, panel: true });

  let S = DEFAULT();
  let fcfg = null, markup = "", value = null, timer = null, obs = null, queued = false;
  let failed = new WeakSet();
  const failedEmu = new WeakSet();
  const upscalers = new Map(), panels = new Map();
  let emu = null, transitioning = false;

  const isActive = () => !!fcfg || S.up.on;
  const status = (state, detail) => {
    try { chrome.runtime.sendMessage({ type: "vf-status", state, detail }).catch(() => {}); } catch (e) {}
  };

  // ================= GPU UPSCALE (WebGL) =================
  const VS = `attribute vec2 p; varying vec2 uv;
    void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }`;

  const FS1 = `precision highp float;
    uniform sampler2D tex; uniform vec2 srcSize; varying vec2 uv;
    float lz(float x){
      x = abs(x);
      if (x < 0.0001) return 1.0;
      if (x >= 2.0) return 0.0;
      float px = 3.14159265*x;
      return 2.0*sin(px)*sin(px*0.5)/(px*px);
    }
    void main(){
      vec2 pp = uv*srcSize - 0.5;
      vec2 b = floor(pp);
      vec2 f = pp - b;
      float wx[4]; float wy[4];
      float sx = 0.0; float sy = 0.0;
      for (int i = 0; i < 4; i++) {
        float d = float(i) - 1.0;
        wx[i] = lz(f.x - d); wy[i] = lz(f.y - d);
        sx += wx[i]; sy += wy[i];
      }
      vec3 col = vec3(0.0);
      vec3 mn = vec3(1.0); vec3 mx = vec3(0.0);
      for (int j = 0; j < 4; j++) {
        for (int i = 0; i < 4; i++) {
          vec2 q = (b + vec2(float(i) - 1.0, float(j) - 1.0) + 0.5) / srcSize;
          vec3 s = texture2D(tex, q).rgb;
          col += s * wx[i] * wy[j];
          if (i >= 1 && i <= 2 && j >= 1 && j <= 2) { mn = min(mn, s); mx = max(mx, s); }
        }
      }
      col = col / (sx*sy);
      gl_FragColor = vec4(clamp(col, mn - 0.02, mx + 0.02), 1.0);
    }`;

  const FS2 = `precision highp float;
    uniform sampler2D tex; uniform vec2 px; uniform float uSharp; varying vec2 uv;
    vec3 T(float x, float y){ return texture2D(tex, uv + vec2(x,y)*px).rgb; }
    void main(){
      vec3 b = T(0.0,-1.0); vec3 d = T(-1.0,0.0); vec3 e = T(0.0,0.0);
      vec3 f = T(1.0,0.0);  vec3 h = T(0.0,1.0);
      vec3 mn = min(min(min(d,e),min(f,b)),h);
      vec3 mx = max(max(max(d,e),max(f,b)),h);
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.0001)), 0.0, 1.0));
      float peak = -1.0 / mix(8.0, 5.0, uSharp);
      vec3 w = amp * peak;
      vec3 res = ((b + d + f + h) * w + e) / (1.0 + 4.0 * w);
      gl_FragColor = vec4(clamp(res, 0.0, 1.0), 1.0);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
    return p;
  }
  function texture(gl, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  class Upscaler {
    constructor(v) {
      this.v = v; this.alive = true; this.ok = false;
      this.tw = 0; this.th = 0; this.ow = 0; this.oh = 0; this.geo = "";
      const c = (this.c = document.createElement("canvas"));
      c.setAttribute("data-vf-up", "1");
      c.style.cssText = "position:absolute;pointer-events:none;visibility:hidden;margin:0;padding:0;border:0;background:transparent";
      const gl = (this.gl = c.getContext("webgl", {
        alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance"
      }));
      if (!gl) throw new Error("nowebgl");

      this.p1 = program(gl, VS, FS1);
      this.p2 = program(gl, VS, FS2);
      this.u1 = { tex: gl.getUniformLocation(this.p1, "tex"), src: gl.getUniformLocation(this.p1, "srcSize") };
      this.u2 = { tex: gl.getUniformLocation(this.p2, "tex"), px: gl.getUniformLocation(this.p2, "px"), sh: gl.getUniformLocation(this.p2, "uSharp") };
      this.a1 = gl.getAttribLocation(this.p1, "p");
      this.a2 = gl.getAttribLocation(this.p2, "p");
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.tex = texture(gl, gl.NEAREST);
      this.ftex = texture(gl, gl.LINEAR);
      this.fbo = gl.createFramebuffer();

      v.parentNode.insertBefore(c, v.nextSibling);

      this.onEv = () => this.draw();
      this.evs = ["seeked", "loadeddata", "resize", "play", "pause", "emptied"];
      this.evs.forEach((e) => v.addEventListener(e, this.onEv));
      this.ro = new ResizeObserver(this.onEv); this.ro.observe(v);
      this.loop = () => {
        if (!this.alive) return;
        this.draw();
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(this.loop);
        else this.raf = requestAnimationFrame(this.loop);
      };
      this.loop();
    }

    layout() {
      const v = this.v, c = this.c, gl = this.gl, cs = getComputedStyle(v);
      const isEmu = emu && emu.v === v;
      const W = isEmu ? innerWidth : v.offsetWidth, H = isEmu ? innerHeight : v.offsetHeight;
      const vw = v.videoWidth, vh = v.videoHeight;
      if (!W || !H || !vw || !vh) return false;
      const dpr = window.devicePixelRatio || 1;
      const fit = isEmu ? "contain" : cs.objectFit;
      let ow, oh;
      if (fit === "fill") { ow = W * dpr; oh = H * dpr; }
      else {
        const s = fit === "cover" ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
        ow = vw * s * dpr; oh = vh * s * dpr;
      }
      if (ow < vw || oh < vh) { ow = vw; oh = vh; }
      if (ow > 3840 || oh > 2160) { const r = Math.min(3840 / ow, 2160 / oh); ow *= r; oh *= r; }
      ow = Math.max(1, Math.round(ow)); oh = Math.max(1, Math.round(oh));
      if (ow !== this.ow || oh !== this.oh) {
        c.width = ow; c.height = oh; this.ow = ow; this.oh = oh;
        gl.bindTexture(gl.TEXTURE_2D, this.ftex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ow, oh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      const clip = v.controls ? "inset(0 0 52px 0)" : "";
      const g = isEmu ? "emu|" + v.controls
        : [v.offsetLeft, v.offsetTop, W, H, fit, cs.objectPosition, cs.transform, cs.transformOrigin, cs.zIndex, v.controls].join("|");
      if (g !== this.geo) {
        this.geo = g;
        if (isEmu) {
          Object.assign(c.style, {
            position: "fixed", left: "0px", top: "0px", width: "100vw", height: "100vh",
            objectFit: "contain", objectPosition: "50% 50%", transform: "", transformOrigin: "",
            zIndex: "2147483001", clipPath: clip
          });
        } else {
          Object.assign(c.style, {
            position: "absolute", left: v.offsetLeft + "px", top: v.offsetTop + "px", width: W + "px", height: H + "px",
            objectFit: fit, objectPosition: cs.objectPosition,
            transform: cs.transform === "none" ? "" : cs.transform, transformOrigin: cs.transformOrigin,
            zIndex: cs.zIndex === "auto" ? "" : cs.zIndex, clipPath: clip
          });
        }
      }
      return true;
    }

    draw() {
      const v = this.v, gl = this.gl;
      if (!this.alive || v.readyState < 2 || !v.videoWidth) return;
      if (v.mediaKeys) { this.fail("drm"); return; }
      if (!this.layout()) return;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        if (v.videoWidth !== this.tw || v.videoHeight !== this.th) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
          this.tw = v.videoWidth; this.th = v.videoHeight;
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, v);
        }
      } catch (e) { this.fail(e && e.name === "SecurityError" ? "tainted" : "error", String(e)); return; }

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ftex, 0);
      gl.viewport(0, 0, this.ow, this.oh);
      gl.useProgram(this.p1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(this.a1);
      gl.vertexAttribPointer(this.a1, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(this.u1.tex, 0);
      gl.uniform2f(this.u1.src, this.tw, this.th);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, this.ftex);
      gl.viewport(0, 0, this.ow, this.oh);
      gl.useProgram(this.p2);
      gl.enableVertexAttribArray(this.a2);
      gl.vertexAttribPointer(this.a2, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(this.u2.tex, 0);
      gl.uniform2f(this.u2.px, 1 / this.ow, 1 / this.oh);
      gl.uniform1f(this.u2.sh, Math.max(0, Math.min(1, S.up.sharp / 100)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!this.ok) { this.ok = true; this.c.style.visibility = "visible"; status("ok"); }
    }

    setFilter(val) { this.c.style.filter = val || ""; }
    fail(reason, detail) { failed.add(this.v); this.destroy(); status(reason, detail); }

    destroy() {
      if (!this.alive && !this.c.isConnected) { upscalers.delete(this.v); return; }
      this.alive = false;
      this.evs.forEach((e) => this.v.removeEventListener(e, this.onEv));
      this.ro.disconnect();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.c.remove();
      try { const x = this.gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); } catch (e) {}
      upscalers.delete(this.v);
    }
  }

  // ================= TAM EKRAN DÜZELTMESİ =================
  // <video> elemanının kendisi tam ekran olursa kardeş öğeler (upscale canvas, panel)
  // görünmez. Çözüm: tam ekranı video yerine kapsayıcıya taşı ve videoyu ekranı dolduracak şekilde ayarla.
  const EMU_PROPS = {
    "position": "fixed", "left": "0", "top": "0", "right": "auto", "bottom": "auto",
    "width": "100vw", "height": "100vh", "max-width": "none", "max-height": "none",
    "min-width": "0", "min-height": "0", "margin": "0", "object-fit": "contain",
    "z-index": "2147483000", "background-color": "#000", "transform": "none"
  };

  function styleEmu(v) {
    emu.saved = {};
    for (const p in EMU_PROPS) {
      emu.saved[p] = { v: v.style.getPropertyValue(p), pr: v.style.getPropertyPriority(p) };
      v.style.setProperty(p, EMU_PROPS[p], "important");
    }
  }
  function relayout() {
    upscalers.forEach((u) => { u.geo = ""; u.draw(); });
    panels.forEach((p) => { p.geo = ""; p.layout(); });
  }
  function exitEmu() {
    if (!emu) return;
    const { v, saved } = emu;
    for (const p in saved) {
      if (saved[p].v) v.style.setProperty(p, saved[p].v, saved[p].pr);
      else v.style.removeProperty(p);
    }
    emu = null;
    relayout();
  }
  function enterEmu(v) {
    const parent = v.parentElement;
    if (!parent || !parent.requestFullscreen) { failedEmu.add(v); return; }
    transitioning = true;
    document.exitFullscreen()
      .then(() => parent.requestFullscreen())
      .then(() => { emu = { v, parent, saved: {} }; styleEmu(v); transitioning = false; relayout(); })
      .catch(() => {
        transitioning = false; failedEmu.add(v);
        try { v.requestFullscreen().catch(() => {}); } catch (e) {}
      });
  }
  document.addEventListener("fullscreenchange", () => {
    if (transitioning) return;
    const fe = document.fullscreenElement;
    if (fe && fe.tagName === "VIDEO" && upscalers.has(fe) && !failedEmu.has(fe)) { enterEmu(fe); return; }
    if (emu && fe !== emu.parent) exitEmu(); else relayout();
  });

  // ================= VİDEO ÜSTÜ PANEL =================
  const LOGO = `<img alt="" width="24" height="24" style="display:block" src="data:image/png;base64,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">`;

  const PANEL_CSS = `
    :host{all:initial}
    *{box-sizing:border-box;margin:0;padding:0;font-family:"Segoe UI",system-ui,sans-serif}
    .wrap{position:absolute;left:10px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:8px;
      max-height:calc(100% - 20px);opacity:0;transition:opacity .2s;pointer-events:none}
    .wrap.show{opacity:1}
    .wrap.show .fab,.wrap.show .card{pointer-events:auto}
    .fab{width:34px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(18,18,26,.82);
      backdrop-filter:blur(8px);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}
    .fab:hover{background:rgba(36,36,53,.92)}
    .card{display:none;width:250px;max-height:100%;overflow-y:auto;background:rgba(18,18,26,.92);backdrop-filter:blur(12px);
      border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px;color:#ecebf5;font-size:12px}
    .open .card{display:block}
    .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .hd b{font-size:13px}
    .off{background:rgba(255,255,255,.08);color:#ecebf5;border:0;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer}
    .off:hover{background:rgba(244,63,94,.3)}
    ul{list-style:none;max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;margin-bottom:8px;padding-right:3px}
    ul::-webkit-scrollbar{width:5px}ul::-webkit-scrollbar-thumb{background:#34344a;border-radius:5px}
    li{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:8px;background:#1b1b27;cursor:pointer;border:1px solid transparent}
    li:hover{background:#242435}
    li.on{border-color:#8b5cf6;background:linear-gradient(90deg,rgba(139,92,246,.25),rgba(34,211,238,.08))}
    .s{width:28px;height:16px;border-radius:5px;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
    .n{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .row{display:flex;justify-content:space-between;color:#8b8aa3;margin:4px 0 3px}
    .row b{color:#ecebf5}
    input[type=range]{width:100%;accent-color:#8b5cf6;cursor:pointer}
    .sw{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
    .sw small{display:block;color:#8b8aa3;font-size:10.5px}
    .switch{position:relative;width:38px;height:22px;flex:none}
    .switch input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:1}
    .switch i{position:absolute;inset:0;background:#34344a;border-radius:999px;transition:.2s}
    .switch i::after{content:"";position:absolute;width:16px;height:16px;top:3px;left:3px;background:#fff;border-radius:50%;transition:.2s}
    .switch input:checked+i{background:linear-gradient(90deg,#8b5cf6,#22d3ee)}
    .switch input:checked+i::after{transform:translateX(16px)}`;

  let persistT = null;
  function commit() {                       // panelden gelen değişiklik
    setState(S);
    clearTimeout(persistT);
    persistT = setTimeout(() => {
      try { chrome.runtime.sendMessage({ type: "vf-save", state: S, from: UID }).catch(() => {}); } catch (e) {}
    }, 250);
  }

  class Panel {
    constructor(v) {
      this.v = v; this.alive = true; this.geo = ""; this.t = null;
      const host = (this.host = document.createElement("div"));
      host.setAttribute("data-vf-panel", "1");
      host.style.cssText = "position:absolute;pointer-events:none;margin:0;padding:0;border:0;z-index:2147483647";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>${PANEL_CSS}</style>
        <div class="wrap">
          <button class="fab" title="${vfT("app_name")}">${LOGO}</button>
          <div class="card">
            <div class="hd"><b>${vfT("app_name")}</b><button class="off">${vfT("off")}</button></div>
            <ul></ul>
            <div class="row"><span>${vfT("intensity")}</span><b class="av"></b></div>
            <input class="amt" type="range" min="0" max="100">
            <div class="sw"><div><b>${vfT("upscale_title")}</b><small>${vfT("upscale_sub")}</small></div>
              <label class="switch"><input class="upon" type="checkbox"><i></i></label></div>
            <div class="row"><span>${vfT("sharpness")}</span><b class="sv"></b></div>
            <input class="shp" type="range" min="0" max="100">
          </div>
        </div>`;
      const q = (s) => root.querySelector(s);
      this.wrap = q(".wrap"); this.list = q("ul"); this.amt = q(".amt"); this.av = q(".av");
      this.upon = q(".upon"); this.shp = q(".shp"); this.sv = q(".sv");

      // Oynatıcının tıklama/klavye kısayolları panelle çakışmasın
      ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "keydown", "keyup", "contextmenu", "wheel"]
        .forEach((ev) => this.wrap.addEventListener(ev, (e) => e.stopPropagation()));

      q(".fab").addEventListener("click", () => {
        this.wrap.classList.toggle("open");
        this.poke();
      });
      q(".off").addEventListener("click", () => { S.index = -1; commit(); });
      this.amt.addEventListener("input", () => { S.amount = +this.amt.value; commit(); });
      this.upon.addEventListener("change", () => { S.up.on = this.upon.checked; commit(); });
      this.shp.addEventListener("input", () => { S.up.sharp = +this.shp.value; commit(); });

      PRESETS.forEach((p, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<div class="s" style="background:${swatchGradient(p)}"></div><span class="n"></span>`;
        li.querySelector(".n").textContent = presetName(p);
        li.addEventListener("click", () => { S.index = i; commit(); });
        this.list.appendChild(li);
      });

      v.parentNode.insertBefore(host, v.nextSibling);
      this.ro = new ResizeObserver(() => this.layout()); this.ro.observe(v);
      this.layout(); this.refresh();
    }

    layout() {
      const v = this.v, h = this.host, isEmu = emu && emu.v === v;
      const key = isEmu ? "emu" : [v.offsetLeft, v.offsetTop, v.offsetWidth, v.offsetHeight].join("|");
      if (key === this.geo) return;
      this.geo = key;
      if (isEmu) Object.assign(h.style, { position: "fixed", left: "0px", top: "0px", width: "100vw", height: "100vh" });
      else Object.assign(h.style, { position: "absolute", left: v.offsetLeft + "px", top: v.offsetTop + "px", width: v.offsetWidth + "px", height: v.offsetHeight + "px" });
    }

    refresh() {
      [...this.list.children].forEach((li, i) => li.classList.toggle("on", i === S.index));
      this.amt.value = S.amount; this.av.textContent = S.amount + "%";
      this.upon.checked = S.up.on;
      this.shp.value = S.up.sharp; this.sv.textContent = S.up.sharp + "%";
    }

    poke() {
      this.wrap.classList.add("show");
      this.layout();
      clearTimeout(this.t);
      // Fare durunca 3 sn sonra gizlen (kart açık olsa bile); fare hareket edince tekrar belirir
      this.t = setTimeout(() => this.wrap.classList.remove("show"), 3000);
    }

    onMove(x, y) {
      const r = this.v.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) this.poke();
    }

    destroy() {
      if (!this.alive) return;
      this.alive = false;
      clearTimeout(this.t); this.ro.disconnect(); this.host.remove();
      panels.delete(this.v);
    }
  }

  let moveQ = false;
  document.addEventListener("mousemove", (e) => {
    if (!panels.size || moveQ) return;
    moveQ = true;
    const x = e.clientX, y = e.clientY;
    requestAnimationFrame(() => { moveQ = false; panels.forEach((p) => p.onMove(x, y)); });
  }, { passive: true, capture: true });

  // ================= FİLTRE + YÖNETİM =================
  function collect(root, vids, roots) {
    roots.push(root);
    root.querySelectorAll("video").forEach((v) => vids.push(v));
    root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) collect(el.shadowRoot, vids, roots); });
  }
  const findSvg = (root) => (root.getElementById ? root.getElementById(SVG_ID) : root.querySelector("#" + SVG_ID));

  function ensureSvg(root) {
    let svg = findSvg(root);
    if (!svg) {
      svg = document.createElementNS(SVGNS, "svg");
      svg.id = SVG_ID;
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
      svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
      const host = root === document ? (document.body || document.documentElement) : root;
      if (!host) return;
      host.appendChild(svg);
    }
    if (svg.dataset.m !== markup) { svg.innerHTML = markup; svg.dataset.m = markup; }
  }

  const upEligible = (v) =>
    v.isConnected && v.parentNode && v.videoWidth > 0 && v.videoHeight < 2160 && v.offsetWidth >= 240 && !failed.has(v);
  const panelEligible = (v) => v.isConnected && v.parentNode && v.offsetWidth >= 240 && v.offsetHeight >= 135;

  function scan() {
    const vids = [], roots = [];
    if (isActive()) collect(document, vids, roots);                    // shadow DOM dahil tam tarama
    else { roots.push(document); Array.from(document.getElementsByTagName("video")).forEach((v) => vids.push(v)); }

    if (fcfg) roots.forEach(ensureSvg);
    else roots.forEach((r) => { const s = findSvg(r); if (s) s.remove(); });

    vids.forEach((v) => {
      if (value) {
        if (v.style.getPropertyValue("filter") !== value || v.style.getPropertyPriority("filter") !== "important")
          v.style.setProperty("filter", value, "important");
      } else if (v.style.getPropertyValue("filter")) v.style.removeProperty("filter");
    });

    upscalers.forEach((u, v) => { if (!v.isConnected || !S.up.on) u.destroy(); else u.setFilter(value); });
    if (S.up.on) {
      vids.forEach((v) => {
        if (upscalers.has(v) || !upEligible(v)) return;
        try { const u = new Upscaler(v); upscalers.set(v, u); u.setFilter(value); }
        catch (e) { failed.add(v); status(e.message === "nowebgl" ? "nowebgl" : "error", e.message); }
      });
    }

    panels.forEach((p, v) => { if (!v.isConnected || !S.panel) p.destroy(); });
    if (S.panel) {
      vids.forEach((v) => {
        if (panels.has(v) || !panelEligible(v)) return;
        try { panels.set(v, new Panel(v)); } catch (e) {}
      });
    }
  }

  function schedule() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }

  function teardown() {
    clearInterval(timer); timer = null;
    if (obs) { obs.disconnect(); obs = null; }
    upscalers.forEach((u) => u.destroy());
    panels.forEach((p) => p.destroy());
    if (emu) { const pe = emu.parent; exitEmu(); if (document.fullscreenElement === pe) document.exitFullscreen().catch(() => {}); }
    const vids = [], roots = [];
    collect(document, vids, roots);
    vids.forEach((v) => v.style.removeProperty("filter"));
    roots.forEach((r) => { const s = findSvg(r); if (s) s.remove(); });
  }

  function normalize(st) {
    st = st || {};
    const amount = Number.isFinite(+st.amount) ? Math.max(0, Math.min(100, +st.amount)) : 100;
    const sharp = st.up && Number.isFinite(+st.up.sharp) ? Math.max(0, Math.min(100, +st.up.sharp)) : 50;
    return {
      index: Number.isInteger(st.index) && PRESETS[st.index] ? st.index : -1,
      amount, up: { on: !!(st.up && st.up.on), sharp }, panel: st.panel !== false
    };
  }

  function setState(st) {
    const prevUp = S.up.on;
    S = normalize(st);
    fcfg = S.index >= 0 ? buildConfig(PRESETS[S.index], S.amount / 100) : null;
    if (!prevUp && S.up.on) failed = new WeakSet();

    if (fcfg) {
      const t = (a) => a.map((x) => Math.max(0, Math.min(1, x)).toFixed(4)).join(" ");
      markup =
        `<filter id="${FID}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">` +
        `<feComponentTransfer>` +
        `<feFuncR type="table" tableValues="${t(fcfg.r)}"/>` +
        `<feFuncG type="table" tableValues="${t(fcfg.g)}"/>` +
        `<feFuncB type="table" tableValues="${t(fcfg.b)}"/>` +
        `</feComponentTransfer>` +
        `<feColorMatrix type="saturate" values="${fcfg.sat.toFixed(3)}"/></filter>`;
      value = `url(#${FID}) contrast(${fcfg.con.toFixed(3)}) brightness(${fcfg.bri.toFixed(3)})`;
    } else { markup = ""; value = null; }

    if (!isActive() && !S.panel) { teardown(); return; }
    if (!obs) { obs = new MutationObserver(schedule); obs.observe(document.documentElement, { childList: true, subtree: true }); }
    if (!timer) timer = setInterval(scan, 1000);
    scan();
    upscalers.forEach((u) => u.draw());
    panels.forEach((p) => p.refresh());
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "vf-apply") return;
    if (msg.from === UID) return;           // kendi gönderdiğimiz değişikliği tekrar uygulama
    setState(msg.state);
  });

  // Dil değişirse (popup'tan) paneller yeni dille yeniden kurulur
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local" || !ch.lang || !ch.lang.newValue || ch.lang.newValue === VF_LANG) return;
      vfSetLang(ch.lang.newValue);
      panels.forEach((p) => p.destroy());
      scan();
    });
  } catch (e) {}

  // Önce dil (kayıtlı seçim > tarayıcı dili), sonra bu SİTE için kayıtlı son ayar
  const start = () => {
    try {
      chrome.runtime.sendMessage({ type: "vf-get" })
        .then((r) => setState(r && r.state ? r.state : DEFAULT()))
        .catch(() => setState(DEFAULT()));
    } catch (e) { setState(DEFAULT()); }
  };
  try {
    chrome.storage.local.get("lang")
      .then((o) => vfSetLang(o.lang || vfDetectLang()))
      .catch(() => vfSetLang(vfDetectLang()))
      .then(start);
  } catch (e) { vfSetLang(vfDetectLang()); start(); }
})();
