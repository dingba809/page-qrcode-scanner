const state = {
  results: [],
  selectedIndex: -1
};

const elements = {};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  cacheElements();
  bindEvents();
  await scanPage();
}

function cacheElements() {
  elements.status = document.getElementById("status");
  elements.summary = document.getElementById("summary");
  elements.results = document.getElementById("results");
  elements.empty = document.getElementById("empty");
  elements.manualButton = document.getElementById("manualButton");
  elements.scanButton = document.getElementById("scanButton");
  elements.copyButton = document.getElementById("copyButton");
  elements.openButton = document.getElementById("openButton");
}

function bindEvents() {
  elements.manualButton.addEventListener("click", startManualSelection);
  elements.scanButton.addEventListener("click", scanPage);
  elements.copyButton.addEventListener("click", copySelected);
  elements.openButton.addEventListener("click", openSelected);
}

async function startManualSelection() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("无法获取当前标签页，请重试。", "error");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START_REGION_SELECT" });
  } catch (_error) {
    setStatus("当前页面不支持框选，请刷新页面后重试。", "error");
    return;
  }

  window.close();
}

async function scanPage() {
  setStatus("正在扫描当前页面...", "loading");
  setSummary("");
  hideEmpty();
  clearResults();
  setFooterEnabled(false);

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("无法获取当前标签页，请重试。", "error");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_QR_CODES" });
    if (!response?.ok) {
      throw new Error(response?.error || "扫描失败");
    }

    const domResults = response.results || [];
    if (domResults.length) {
      renderResults(domResults);
      return;
    }

    await scanVisibleArea(tab);
  } catch (error) {
    const message = chrome.runtime.lastError?.message || error.message || String(error);
    if (/Receiving end does not exist/i.test(message)) {
      setStatus("当前页面不支持扫描，请刷新页面后重试。", "error");
    } else {
      setStatus(`扫描失败：${message}`, "error");
    }
    showEmpty("无法完成扫描", "Chrome 内部页面或部分受限页面不能注入扫描脚本。");
  }
}

async function scanVisibleArea(tab) {
  setStatus("页面元素中未找到，正在截取当前屏幕识别...", "loading");

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch (_error) {
    renderResults([]);
    return;
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "SCAN_DATA_URL",
    dataUrl
  });

  if (!response?.ok) {
    throw new Error(response?.error || "截图识别失败");
  }

  renderResults(response.results || []);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function renderResults(results) {
  state.results = results;
  state.selectedIndex = results.length === 1 ? 0 : -1;

  if (!results.length) {
    setStatus("没有识别到二维码", "success");
    showEmpty("没有识别到二维码", "请确认页面中的二维码以图片或画布形式显示，然后重新扫描。");
    return;
  }

  setStatus(`识别到 ${results.length} 个二维码`, "success");
  setSummary("点击二维码进行选择");
  hideEmpty();
  clearResults();

  results.forEach((result, index) => {
    elements.results.appendChild(createResultRow(result, index));
  });

  updateSelection();
}

function createResultRow(result, index) {
  const url = toUrl(result.text);
  const row = document.createElement("article");
  row.className = "result";
  row.dataset.index = String(index);
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.addEventListener("click", () => selectResult(index));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectResult(index);
    }
  });

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (result.thumbnail) {
    const image = document.createElement("img");
    image.src = result.thumbnail;
    image.alt = "二维码预览";
    thumb.appendChild(image);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "thumb-fallback";
    fallback.textContent = "QR";
    thumb.appendChild(fallback);
  }

  const body = document.createElement("div");
  body.className = "result-body";

  const topline = document.createElement("div");
  topline.className = "result-topline";

  const badge = document.createElement("span");
  badge.className = `badge ${url ? "url" : "text"}`;
  badge.textContent = url ? "URL" : "文本";

  const source = document.createElement("span");
  source.className = "source";
  const sourceName =
    result.source === "canvas" ? "画布" : result.source === "screenshot" ? "截图" : "图片";
  source.textContent = `${sourceName} · ${result.width}×${result.height}`;

  topline.append(badge, source);

  const value = document.createElement("div");
  value.className = "value";
  value.textContent = url || result.text;
  value.title = result.text;

  body.append(topline, value);
  row.append(thumb, body);
  return row;
}

function selectResult(index) {
  if (state.results[index]) {
    state.selectedIndex = index;
    updateSelection();
  }
}

function updateSelection() {
  document.querySelectorAll(".result").forEach((row) => {
    const index = Number(row.dataset.index);
    row.classList.toggle("is-selected", index === state.selectedIndex);
  });

  const selected = state.results[state.selectedIndex];
  const hasSelection = Boolean(selected);
  const hasUrl = hasSelection && Boolean(toUrl(selected.text));
  elements.copyButton.disabled = !hasSelection;
  elements.openButton.disabled = !hasUrl;
}

async function copySelected() {
  const selected = state.results[state.selectedIndex];
  if (!selected) {
    return;
  }

  const success = await copyText(selected.text);
  setStatus(success ? "已复制到剪贴板" : "复制失败，请手动复制", success ? "success" : "error");
}

async function openSelected() {
  const selected = state.results[state.selectedIndex];
  const url = selected ? toUrl(selected.text) : null;
  if (!url) {
    return;
  }

  await chrome.tabs.create({ url });
  window.close();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function toUrl(text) {
  const value = text.trim();
  if (!value) {
    return null;
  }

  if (/^(https?|ftp):\/\//i.test(value) || /^(mailto|tel|sms|geo|bitcoin|ethereum):/i.test(value)) {
    return value;
  }

  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return null;
}

function setStatus(message, kind) {
  elements.status.textContent = message;
  elements.status.className = "status";
  if (kind === "error") {
    elements.status.classList.add("is-error");
  }
  if (kind === "success") {
    elements.status.classList.add("is-success");
  }
}

function setSummary(message) {
  elements.summary.textContent = message;
  elements.summary.hidden = !message;
}

function clearResults() {
  elements.results.replaceChildren();
}

function showEmpty(title, message) {
  elements.empty.querySelector(".empty-title").textContent = title;
  elements.empty.querySelector("p").textContent = message;
  elements.empty.hidden = false;
}

function hideEmpty() {
  elements.empty.hidden = true;
}

function setFooterEnabled(enabled) {
  elements.copyButton.disabled = !enabled;
  elements.openButton.disabled = !enabled;
}
