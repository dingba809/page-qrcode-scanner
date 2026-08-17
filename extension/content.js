(() => {
  if (window.__qrScannerContentLoaded) {
    return;
  }
  window.__qrScannerContentLoaded = true;

  const MAX_IMAGE_DIMENSION = 2000;
  const MAX_CANDIDATES = 120;
  const MAX_CODES_PER_IMAGE = 12;
  const ITEM_TIMEOUT_MS = 12000;
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCAN_QR_CODES") {
      scanPage()
        .then((results) => sendResponse({ ok: true, results }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type === "SCAN_DATA_URL") {
      scanDataUrl(message.dataUrl)
        .then((results) => sendResponse({ ok: true, results }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type === "START_REGION_SELECT") {
      startRegionSelection();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  async function scanPage() {
    const candidates = collectCandidates();
    const results = [];

    for (const candidate of candidates) {
      try {
        const result = await withTimeout(processCandidate(candidate), ITEM_TIMEOUT_MS);
        if (Array.isArray(result)) {
          results.push(...result.filter((item) => item?.text));
        } else if (result?.text) {
          results.push(result);
        }
      } catch (_error) {
        // 单个图片解码失败不应中断整体扫描。
      }
    }

    return results;
  }

  function collectCandidates() {
    const candidates = [];
    const seen = new Set();

    querySelectorAllDeep("img").forEach((img) => {
      const src = img.currentSrc || img.src;
      if (!src || !isVisible(img)) {
        return;
      }

      const key = `img:${src}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push({ id: key, type: "img", element: img, src });
    });

    querySelectorAllDeep("canvas").forEach((canvas, index) => {
      if (!isVisible(canvas) || canvas.width < 20 || canvas.height < 20) {
        return;
      }
      candidates.push({
        id: `canvas:${index}:${canvas.width}x${canvas.height}`,
        type: "canvas",
        element: canvas,
        src: null
      });
    });

    return candidates.slice(0, MAX_CANDIDATES);
  }

  function querySelectorAllDeep(selector) {
    const results = [];
    const visited = new WeakSet();

    function walk(root) {
      if (visited.has(root)) {
        return;
      }
      visited.add(root);

      root.querySelectorAll(selector).forEach((element) => results.push(element));
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) {
          walk(element.shadowRoot);
        }
      });
    }

    walk(document);
    return results;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) {
      return false;
    }

    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0
    );
  }

  async function processCandidate(candidate) {
    if (candidate.type === "img") {
      const image = await loadRasterImage(candidate.src);
      const imageData = imageToImageData(image);
      if (!imageData) {
        return null;
      }

      const codes = decodeAllFromImageData(imageData);
      if (!codes.length) {
        return null;
      }

      return codes.map((code, index) => {
        const bounds = getCodeBounds(code.location, imageData.width, imageData.height);
        return {
          id: `${candidate.id}#${index}`,
          text: code.data,
          thumbnail: makeRegionThumbnail(imageData, bounds, 240),
          source: "img",
          width: bounds.width,
          height: bounds.height,
          src: candidate.src
        };
      });
    }

    if (candidate.type === "canvas") {
      const canvas = candidate.element;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return null;
      }

      let imageData;
      try {
        imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      } catch (_error) {
        return null;
      }

      const codes = decodeAllFromImageData(imageData);
      if (!codes.length) {
        return null;
      }

      return codes.map((code, index) => {
        const bounds = getCodeBounds(code.location, imageData.width, imageData.height);
        return {
          id: `${candidate.id}#${index}`,
          text: code.data,
          thumbnail: makeRegionThumbnail(imageData, bounds, 240),
          source: "canvas",
          width: bounds.width,
          height: bounds.height,
          src: null
        };
      });
    }

    return null;
  }

  async function loadRasterImage(src) {
    let objectUrl = null;

    try {
      const resolved = await resolveSource(src);
      objectUrl = resolved.objectUrl;

      const image = new Image();
      image.decoding = "async";
      image.src = objectUrl || src;
      await image.decode();
      return image;
    } finally {
      if (objectUrl) {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }

  async function scanDataUrl(dataUrl) {
    const image = new Image();
    image.decoding = "async";
    image.src = dataUrl;
    await image.decode();

    const imageData = imageToImageData(image);
    if (!imageData) {
      return [];
    }

    const codes = decodeAllFromImageData(imageData);
    return codes.map((code, index) => {
      const bounds = getCodeBounds(code.location, imageData.width, imageData.height);
      return {
        id: `screenshot:${index}`,
        text: code.data,
        thumbnail: makeRegionThumbnail(imageData, bounds, 240),
        source: "screenshot",
        width: bounds.width,
        height: bounds.height,
        src: null
      };
    });
  }

  async function resolveSource(src) {
    if (/^data:/i.test(src)) {
      return { objectUrl: null };
    }

    if (/^blob:/i.test(src)) {
      const blob = await fetchDirect(src);
      return { objectUrl: URL.createObjectURL(blob) };
    }

    const response = await chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: src });
    if (!response?.ok) {
      throw new Error(response?.error || t("imageGrabFailed"));
    }

    const blob = new Blob([response.data], {
      type: response.mime || ""
    });
    return { objectUrl: URL.createObjectURL(blob) };
  }

  async function fetchDirect(src) {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(t("imageReadFailed"));
    }
    return response.blob();
  }

  function imageToImageData(image) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) {
      return null;
    }

    const scale = Math.max(sourceWidth, sourceHeight) > MAX_IMAGE_DIMENSION
      ? MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight)
      : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return context.getImageData(0, 0, width, height);
  }

  function decodeAllFromImageData(imageData) {
    const working = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
    const codes = [];

    for (let index = 0; index < MAX_CODES_PER_IMAGE; index += 1) {
      const code = jsQR(working.data, working.width, working.height);
      if (!code?.data) {
        break;
      }

      codes.push(code);
      blankCodeRegion(working.data, working.width, working.height, code.location);
    }

    return codes;
  }

  function getCodeBounds(location, width, height) {
    const corners = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner
    ].filter(Boolean);

    if (!corners.length) {
      return { x: 0, y: 0, width, height };
    }

    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    const padding = Math.max(4, Math.round((maxX - minX + maxY - minY) / 12));
    minX = Math.max(0, Math.floor(minX - padding));
    minY = Math.max(0, Math.floor(minY - padding));
    maxX = Math.min(width - 1, Math.ceil(maxX + padding));
    maxY = Math.min(height - 1, Math.ceil(maxY + padding));

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1)
    };
  }

  function blankCodeRegion(data, width, height, location) {
    const bounds = getCodeBounds(location, width, height);

    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
      }
    }
  }

  function makeRegionThumbnail(imageData, bounds, maxSize) {
    const sourceWidth = imageData.width;
    const sourceHeight = imageData.height;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    sourceCanvas.getContext("2d").putImageData(imageData, 0, 0);

    const sourceX = Math.max(0, Math.min(bounds.x, sourceWidth - 1));
    const sourceY = Math.max(0, Math.min(bounds.y, sourceHeight - 1));
    const cropWidth = Math.min(bounds.width, sourceWidth - sourceX);
    const cropHeight = Math.min(bounds.height, sourceHeight - sourceY);
    const scale = Math.min(1, maxSize / Math.max(cropWidth, cropHeight));
    const destWidth = Math.max(1, Math.round(cropWidth * scale));
    const destHeight = Math.max(1, Math.round(cropHeight * scale));

    const destCanvas = document.createElement("canvas");
    destCanvas.width = destWidth;
    destCanvas.height = destHeight;

    const destContext = destCanvas.getContext("2d");
    destContext.fillStyle = "#ffffff";
    destContext.fillRect(0, 0, destWidth, destHeight);
    destContext.drawImage(
      sourceCanvas,
      sourceX,
      sourceY,
      cropWidth,
      cropHeight,
      0,
      0,
      destWidth,
      destHeight
    );

    try {
      return destCanvas.toDataURL("image/png");
    } catch (_error) {
      return null;
    }
  }

  function startRegionSelection() {
    removeManualUi();

    const overlay = document.createElement("div");
    overlay.className = "qrs-manual-overlay";

    const toolbar = document.createElement("div");
    toolbar.className = "qrs-manual-toolbar";
    toolbar.textContent = t("dragHint");

    const selection = document.createElement("div");
    selection.className = "qrs-manual-selection";

    overlay.append(toolbar, selection);
    document.documentElement.appendChild(overlay);

    let startX = 0;
    let startY = 0;
    let selecting = false;

    const updateSelection = (currentX, currentY) => {
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      selection.style.left = `${x}px`;
      selection.style.top = `${y}px`;
      selection.style.width = `${width}px`;
      selection.style.height = `${height}px`;
    };

    const stopSelection = () => {
      selecting = false;
      overlay.classList.remove("is-selecting");
      window.removeEventListener("keydown", handleKeydown, true);
      overlay.remove();
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stopSelection();
      }
    };

    overlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      selecting = true;
      startX = event.clientX;
      startY = event.clientY;
      updateSelection(startX, startY);
      overlay.classList.add("is-selecting");
    });

    overlay.addEventListener("pointermove", (event) => {
      if (!selecting) {
        return;
      }
      updateSelection(event.clientX, event.clientY);
    });

    overlay.addEventListener("pointerup", (event) => {
      if (!selecting) {
        return;
      }

      const rect = {
        x: Math.min(startX, event.clientX),
        y: Math.min(startY, event.clientY),
        width: Math.abs(event.clientX - startX),
        height: Math.abs(event.clientY - startY)
      };

      stopSelection();

      if (rect.width < 8 || rect.height < 8) {
        showManualMessage(t("areaTooSmall"));
        return;
      }

      captureAndDecodeRegion(rect);
    });

    window.addEventListener("keydown", handleKeydown, true);
  }

  async function captureAndDecodeRegion(rect) {
    showManualLoading();

    try {
      const captureResponse = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
      if (!captureResponse?.ok) {
        throw new Error(captureResponse?.error || t("captureFailed"));
      }

      const results = await decodeRegionFromScreenshot(captureResponse.dataUrl, rect);
      showManualResults(results);
    } catch (error) {
      showManualMessage(error.message || t("manualFailed"));
    }
  }

  async function decodeRegionFromScreenshot(dataUrl, rect) {
    const image = new Image();
    image.decoding = "async";
    image.src = dataUrl;
    await image.decode();

    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const scaleX = sourceWidth / viewportWidth;
    const scaleY = sourceHeight / viewportHeight;

    let sourceX = Math.max(0, Math.round(rect.x * scaleX));
    let sourceY = Math.max(0, Math.round(rect.y * scaleY));
    let cropWidth = Math.max(1, Math.round(rect.width * scaleX));
    let cropHeight = Math.max(1, Math.round(rect.height * scaleY));
    cropWidth = Math.min(cropWidth, sourceWidth - sourceX);
    cropHeight = Math.min(cropHeight, sourceHeight - sourceY);

    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    const imageData = context.getImageData(0, 0, cropWidth, cropHeight);
    const codes = decodeAllFromImageData(imageData);

    return codes.map((code, index) => {
      const bounds = getCodeBounds(code.location, imageData.width, imageData.height);
      return {
        id: `manual:${index}`,
        text: code.data,
        thumbnail: makeRegionThumbnail(imageData, bounds, 240),
        source: "manual",
        width: bounds.width,
        height: bounds.height,
        src: null
      };
    });
  }

  function showManualLoading() {
    removeManualPanel();

    const panel = document.createElement("div");
    panel.className = "qrs-manual-panel";
    panel.innerHTML = `
      <div class="qrs-manual-panel-header">
        <div class="qrs-manual-panel-title"></div>
      </div>
      <div class="qrs-manual-state"></div>
    `;
    panel.querySelector(".qrs-manual-panel-title").textContent = t("scanningLabel");
    panel.querySelector(".qrs-manual-state").textContent = t("processingArea");
    document.documentElement.appendChild(panel);
  }

  function showManualResults(results) {
    removeManualPanel();

    const panel = document.createElement("div");
    panel.className = "qrs-manual-panel";

    const header = document.createElement("div");
    header.className = "qrs-manual-panel-header";

    const title = document.createElement("div");
    title.className = "qrs-manual-panel-title";
    title.textContent = results.length ? t("foundQrCodes", [String(results.length)]) : t("noQrFound");

    const closeButton = document.createElement("button");
    closeButton.className = "qrs-manual-close";
    closeButton.type = "button";
    closeButton.textContent = t("close");
    closeButton.addEventListener("click", removeManualPanel);

    header.append(title, closeButton);
    panel.appendChild(header);

    if (!results.length) {
      const state = document.createElement("div");
      state.className = "qrs-manual-state";
      state.textContent = t("noQrInSelection");
      panel.appendChild(state);
    } else {
      const list = document.createElement("div");
      list.className = "qrs-manual-list";

      results.forEach((result) => {
        list.appendChild(createManualResultItem(result));
      });

      panel.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "qrs-manual-panel-actions";

    const againButton = document.createElement("button");
    againButton.className = "qrs-manual-button";
    againButton.type = "button";
    againButton.textContent = t("selectAgain");
    againButton.addEventListener("click", () => {
      removeManualPanel();
      startRegionSelection();
    });

    const closeBottomButton = document.createElement("button");
    closeBottomButton.className = "qrs-manual-button primary";
    closeBottomButton.type = "button";
    closeBottomButton.textContent = t("done");
    closeBottomButton.addEventListener("click", removeManualPanel);

    actions.append(againButton, closeBottomButton);
    panel.appendChild(actions);
    document.documentElement.appendChild(panel);
  }

  function createManualResultItem(result) {
    const item = document.createElement("div");
    item.className = "qrs-manual-item";

    const thumb = document.createElement("div");
    thumb.className = "qrs-manual-thumb";

    if (result.thumbnail) {
      const image = document.createElement("img");
      image.src = result.thumbnail;
      image.alt = t("qrPreview");
      thumb.appendChild(image);
    } else {
      thumb.textContent = "QR";
    }

    const body = document.createElement("div");
    body.className = "qrs-manual-item-body";

    const text = document.createElement("div");
    text.className = "qrs-manual-value";
    const url = toUrlText(result.text);
    text.textContent = url || result.text;
    text.title = result.text;

    const actions = document.createElement("div");
    actions.className = "qrs-manual-actions";

    const copyButton = document.createElement("button");
    copyButton.className = "qrs-manual-button";
    copyButton.type = "button";
    copyButton.textContent = t("copy");
    copyButton.addEventListener("click", async () => {
      const copied = await copyTextManual(result.text);
      copyButton.textContent = copied ? t("copiedShort") : t("copyFailedShort");
      setTimeout(() => {
        copyButton.textContent = t("copy");
      }, 1200);
    });

    actions.appendChild(copyButton);

    if (url) {
      const openButton = document.createElement("button");
      openButton.className = "qrs-manual-button primary";
      openButton.type = "button";
      openButton.textContent = t("open");
      openButton.addEventListener("click", () => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
      actions.appendChild(openButton);
    }

    body.append(text, actions);
    item.append(thumb, body);
    return item;
  }

  function showManualMessage(message) {
    removeManualPanel();

    const panel = document.createElement("div");
    panel.className = "qrs-manual-panel";
    panel.innerHTML = `
      <div class="qrs-manual-panel-header">
        <div class="qrs-manual-panel-title"></div>
        <button class="qrs-manual-close" type="button"></button>
      </div>
      <div class="qrs-manual-state"></div>
      <div class="qrs-manual-panel-actions">
        <button class="qrs-manual-button" type="button"></button>
        <button class="qrs-manual-button primary" type="button"></button>
      </div>
    `;

    panel.querySelector(".qrs-manual-panel-title").textContent = t("notice");
    panel.querySelector(".qrs-manual-close").textContent = t("close");
    panel.querySelector(".qrs-manual-state").textContent = message;
    panel.querySelector(".qrs-manual-button").textContent = t("selectAgain");
    panel.querySelector(".qrs-manual-button.primary").textContent = t("done");
    panel.querySelector(".qrs-manual-close").addEventListener("click", removeManualPanel);
    panel.querySelector(".qrs-manual-button").addEventListener("click", () => {
      removeManualPanel();
      startRegionSelection();
    });
    panel.querySelector(".qrs-manual-button.primary").addEventListener("click", removeManualPanel);
    document.documentElement.appendChild(panel);
  }

  function removeManualPanel() {
    document.querySelectorAll(".qrs-manual-panel").forEach((panel) => panel.remove());
  }

  function removeManualUi() {
    document.querySelectorAll(".qrs-manual-overlay").forEach((overlay) => overlay.remove());
    removeManualPanel();
  }

  async function copyTextManual(text) {
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

  function toUrlText(text) {
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

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
})();
