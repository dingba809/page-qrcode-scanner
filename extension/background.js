const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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
    throw new Error("仅支持 http(s) 图片");
  }

  const response = await fetch(url, {
    credentials: "include",
    cache: "force-cache"
  });

  if (!response.ok) {
    throw new Error(`图片请求失败（HTTP ${response.status}）`);
  }

  const blob = await response.blob();
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error("图片超过 25MB，已跳过");
  }

  const data = await blob.arrayBuffer();
  return {
    data,
    mime: blob.type || response.headers.get("content-type") || ""
  };
}
