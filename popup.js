const $ = (s) => document.querySelector(s);
const list = $("#list"), q = $("#q"), amount = $("#amount"), amountVal = $("#amountVal"), status = $("#status");
const upOn = $("#upOn"), sharp = $("#sharp"), sharpVal = $("#sharpVal"), panelOn = $("#panelOn");

let tabId = null, key = "", host = "";
const DEFAULT = () => ({ index: -1, amount: 100, up: { on: false, sharp: 50 }, panel: true });
let state = DEFAULT();

const hostOf = (u) => { try { return new URL(u).hostname || "local"; } catch (e) { return "local"; } };
function normalize(st) {
  const d = DEFAULT(); st = st || {};
  return {
    index: Number.isInteger(st.index) && PRESETS[st.index] ? st.index : d.index,
    amount: Number.isFinite(+st.amount) ? +st.amount : d.amount,
    up: { on: !!(st.up && st.up.on), sharp: st.up && Number.isFinite(+st.up.sharp) ? +st.up.sharp : 50 },
    panel: st.panel !== false
  };
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}

// ---------- Dil ----------
function applyI18n() {
  document.documentElement.lang = VF_LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = vfT(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = vfT(el.dataset.i18nPh); });
  document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("active", b.dataset.lang === VF_LANG));
  $("#off").title = vfT("off");
  // "{host}" yer tutucusunu kalın alan adıyla değiştir
  const [a, b] = vfT("hint").split("{host}");
  const hint = $("#hint"); hint.textContent = a;
  const bold = document.createElement("b"); bold.textContent = host; hint.appendChild(bold);
  hint.appendChild(document.createTextNode(b || ""));
}
document.querySelectorAll(".lang button").forEach((b) => {
  b.addEventListener("click", () => {
    vfSetLang(b.dataset.lang);
    chrome.storage.local.set({ lang: VF_LANG });   // video üstü panel de bu değişimi dinler
    syncControls();
  });
});

function curName() { return state.index >= 0 ? presetName(PRESETS[state.index]) : vfT("status_none"); }
function updateStatus() { status.textContent = curName() + (state.up.on ? " · " + vfT("status_up") : ""); }
function syncControls() {
  applyI18n();
  amount.value = state.amount; amountVal.textContent = state.amount + "%";
  upOn.checked = state.up.on; sharp.value = state.up.sharp; sharpVal.textContent = state.up.sharp + "%";
  panelOn.checked = state.panel;
  updateStatus(); render();
}

// ---------- Kaydet (site bazında) + sekmedeki tüm iframe'lere gönder ----------
function save() { return chrome.storage.local.set({ [key]: state }); }

async function push() {
  await save();
  const msg = { type: "vf-apply", state };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["presets.js", "i18n.js", "content.js"] });
      await chrome.tabs.sendMessage(tabId, msg);
      return true;
    } catch (e2) {
      toast(vfT("toast_cannot"));
      return false;
    }
  }
}

chrome.runtime.onMessage.addListener((m) => {
  if (!m || m.type !== "vf-status" || !state.up.on) return;
  if (m.state === "ok") { status.textContent = curName() + " · " + vfT("status_up_active"); return; }
  const k = "toast_" + m.state;
  if (I18N.en[k]) { toast(vfT(k)); if (m.detail) console.warn("[VideoFilter]", m.detail); }
});

// Video üstü panelden yapılan değişiklikler popup açıkken de yansısın
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.lang && ch.lang.newValue && ch.lang.newValue !== VF_LANG) { vfSetLang(ch.lang.newValue); syncControls(); }
  if (!ch[key] || !ch[key].newValue) return;
  const next = normalize(ch[key].newValue);
  if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; syncControls(); }
});

// ---------- Arayüz ----------
function render() {
  const term = q.value.trim().toLowerCase();
  list.innerHTML = "";
  let shown = 0;
  PRESETS.forEach((p, i) => {
    if (term && !(presetName(p) + " " + presetTag(p)).toLowerCase().includes(term)) return;
    shown++;
    const li = document.createElement("li");
    li.className = "item" + (i === state.index ? " active" : "");
    li.innerHTML = `<div class="swatch" style="background:${swatchGradient(p)}"></div><span class="name"></span><span class="tag"></span>`;
    li.querySelector(".name").textContent = presetName(p);
    li.querySelector(".tag").textContent = presetTag(p);
    li.addEventListener("click", () => select(i));
    list.appendChild(li);
  });
  if (!shown) {
    const e = document.createElement("li"); e.className = "empty"; e.textContent = vfT("no_results"); list.appendChild(e);
  }
}

async function select(i) {
  const prev = state.index;
  state.index = i;
  if (await push()) { updateStatus(); render(); } else state.index = prev;
}

$("#off").addEventListener("click", async () => {
  state.index = -1;
  if (await push()) { updateStatus(); render(); }
});

amount.addEventListener("input", () => {
  state.amount = +amount.value; amountVal.textContent = state.amount + "%";
  if (state.index >= 0) push();
});

upOn.addEventListener("change", async () => {
  state.up.on = upOn.checked;
  if (await push()) updateStatus(); else { upOn.checked = false; state.up.on = false; }
});
sharp.addEventListener("input", () => {
  state.up.sharp = +sharp.value; sharpVal.textContent = state.up.sharp + "%";
  if (state.up.on) push();
});
panelOn.addEventListener("change", () => { state.panel = panelOn.checked; push(); });

q.addEventListener("input", render);

(async function init() {
  // Dil: kayıtlı seçim > tarayıcı dili (tr ise Türkçe, değilse İngilizce)
  const { lang } = await chrome.storage.local.get("lang");
  vfSetLang(lang || vfDetectLang());

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  host = hostOf(tab.url);
  key = "site_" + host;
  const saved = (await chrome.storage.local.get(key))[key];
  state = normalize(saved);
  syncControls();
  q.focus();
})();
