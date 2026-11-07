// Ortak dil dosyası: popup ve içerik betiği (video üstü panel) tarafından kullanılır.
var I18N = {
  en: {
    app_name: "Luminique", off: "Off",
    status_choose: "Pick a filter", status_none: "No filter",
    status_up: "GPU upscale", status_up_active: "GPU upscale active",
    search_ph: "Search filters…", no_results: "No results",
    intensity: "Intensity", sharpness: "Sharpness",
    upscale_title: "GPU 4K Upscale", upscale_sub: "WebGL · Lanczos + sharpening",
    panel_title: "On-video panel", panel_sub: "Appears on the left when you move the mouse over the video",
    hint: "Settings are remembered for {host}", language: "Language",
    toast_tainted: "This video has an access restriction (CORS); upscale could not be applied. Filters still work.",
    toast_drm: "DRM-protected video: upscale can't be applied.",
    toast_nowebgl: "WebGL / hardware acceleration is off. Enable it in your browser settings.",
    toast_error: "Upscale could not start.",
    toast_cannot: "Doesn't work on this page (it may be a browser internal page).",
    tag_clean: "Clean", tag_cinema: "Cinema", tag_film: "Film", tag_hdr: "HDR",
    tag_color: "Color", tag_retro: "Retro", tag_bw: "B&W"
  },
  tr: {
    app_name: "Luminique", off: "Kapat",
    status_choose: "Bir filtre seç", status_none: "Filtre yok",
    status_up: "GPU upscale", status_up_active: "GPU upscale aktif",
    search_ph: "Filtre ara…", no_results: "Sonuç bulunamadı",
    intensity: "Yoğunluk", sharpness: "Keskinlik",
    upscale_title: "GPU 4K Upscale", upscale_sub: "WebGL · Lanczos + keskinleştirme",
    panel_title: "Video üzerinde panel", panel_sub: "Fareyi videoya getirince solda çıkar",
    hint: "Ayarlar {host} sitesi için hatırlanır", language: "Dil",
    toast_tainted: "Bu videoda erişim kısıtı (CORS) var, upscale uygulanamadı. Filtreler yine çalışır.",
    toast_drm: "DRM korumalı video: upscale uygulanamaz.",
    toast_nowebgl: "WebGL / donanım hızlandırma kapalı. Tarayıcı ayarlarından açmalısın.",
    toast_error: "Upscale başlatılamadı.",
    toast_cannot: "Bu sayfada çalışmıyor (tarayıcı iç sayfası olabilir).",
    tag_clean: "Temiz", tag_cinema: "Sinema", tag_film: "Film", tag_hdr: "HDR",
    tag_color: "Renk", tag_retro: "Retro", tag_bw: "S/B"
  }
};

var VF_LANG = "en";

// Tarayıcı dili Türkçe ise "tr", diğer tüm durumlarda "en"
function vfDetectLang() {
  let l = "en";
  try { l = (chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : navigator.language) || "en"; } catch (e) {}
  return String(l).toLowerCase().startsWith("tr") ? "tr" : "en";
}
function vfSetLang(l) { VF_LANG = I18N[l] ? l : "en"; }
function vfT(key) { return (I18N[VF_LANG] && I18N[VF_LANG][key]) || I18N.en[key] || key; }
function presetName(p) { return VF_LANG === "tr" && p.tr ? p.tr : p.name; }
function presetTag(p) { return vfT("tag_" + p.tag); }

