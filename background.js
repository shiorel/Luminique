// Ayarlar SİTE (hostname) bazında saklanır: site_<hostname>
const hostOf = (u) => { try { return new URL(u).hostname || "local"; } catch (e) { return "local"; } };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender.tab) return;
  const key = "site_" + hostOf(sender.tab.url || sender.url);

  if (msg.type === "vf-get") {                       // sayfa/iframe açılırken
    chrome.storage.local.get(key).then((o) => sendResponse({ state: o[key] || null }));
    return true;
  }
  if (msg.type === "vf-save") {                      // video üstü panelden değişiklik
    chrome.storage.local.set({ [key]: msg.state }).then(() => {
      // Aynı sekmedeki diğer iframe'lere yay (gönderen hariç, content.js "from" ile eler)
      chrome.tabs.sendMessage(sender.tab.id, { type: "vf-apply", state: msg.state, from: msg.from }).catch(() => {});
    });
  }
});
