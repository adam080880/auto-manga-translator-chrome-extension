// Fetch cross-origin images on behalf of content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "FETCH_IMAGE") return false;

  fetch(msg.src)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const reader = new FileReader();
      reader.onloadend = () => sendResponse({ dataUrl: reader.result });
      reader.onerror = () => sendResponse({ error: "Failed to read blob" });
      reader.readAsDataURL(blob);
    })
    .catch((err) => sendResponse({ error: err.message }));

  return true; // keep message channel open for async response
});
