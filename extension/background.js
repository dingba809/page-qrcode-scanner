const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FETCH_IMAGE") {
    fetchImage(message.url)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "CAPTURE_VISIBLE_TAB") {
    captureVisibleTab(sender)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});

function captureVisibleTab(sender) {
  const options = { format: "png" };
  if (sender.tab?.windowId != null) {
    return chrome.tabs.captureVisibleTab(sender.tab.windowId, options);
  }
  return chrome.tabs.captureVisibleTab(options);
}

async function fetchImage(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(t("imageSchemeUnsupported"));
  }

  const response = await fetch(url, {
    credentials: "include",
    cache: "force-cache"
  });

  if (!response.ok) {
    throw new Error(t("imageFetchFailed", [String(response.status)]));
  }

  const blob = await response.blob();
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(t("imageTooLarge"));
  }

  const data = await blob.arrayBuffer();
  return {
    data,
    mime: blob.type || response.headers.get("content-type") || ""
  };
}
