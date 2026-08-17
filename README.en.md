# Page QR Code Scanner

中文: [README.md](README.md)

A Manifest V3 Chrome extension that scans QR codes on the current page and extracts the text or URL they contain. When a page has multiple QR codes, you can select one in the popup to copy or open it, or manually select a screen region to scan.

## Features

- Automatically scans visible `<img>` and `<canvas>` elements on the current page.
- Walks open Shadow DOM, so QR codes inside Web Components are also detected.
- Falls back to capturing the visible tab when no page element contains a QR code.
- Detects multiple QR codes in a single image by blanking each recognized region and scanning again.
- Supports manual area selection, with results shown in the bottom-right corner of the page.
- Detects URLs automatically for one-click opening; non-URL text can still be copied.
- Decodes everything locally with `jsQR`, with no backend service.
- Supports English and Chinese interfaces, switching automatically based on the browser language.

## Directory Structure

```text
.
├── extension/
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── icons/
│   └── lib/
│       ├── jsqr.js
│       └── jsqr.LICENSE.txt
├── tools/
│   └── generate-icons.mjs
├── README.md
└── README.en.md
```

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/dingba809/page-qrcode-scanner.git
   ```

2. Open Chrome and go to `chrome://extensions/`.
3. Enable "Developer mode" in the top-right corner.
4. Click "Load unpacked".
5. Select the `extension` directory in this repository.

## Usage

1. Open a page that contains a QR code.
2. Click the extension icon in the browser toolbar.
3. The extension automatically scans the current page.
4. When there are multiple QR codes, click the one you want and then click "Copy selected" or "Open selected".

Manual area selection:

1. Click "Select area" in the top-right corner of the extension popup.
2. Drag over the QR code area on the page.
3. The results appear in the bottom-right corner of the page, where you can copy or open them.

## Permissions

- `clipboardWrite`: copies recognized results to the clipboard.
- `<all_urls>`: fetches cross-origin images on the page and captures the visible tab for manual area selection.

The extension does not upload page data to any remote service. QR decoding happens locally in the browser.

## How It Works

- The content script scans `<img>` and `<canvas>` elements in the normal DOM and open Shadow DOM.
- Cross-origin images are fetched by the background Service Worker and then decoded by the content script.
- Decoding uses the bundled `jsQR` and can detect multiple QR codes in a single image.
- Manual selection uses `chrome.tabs.captureVisibleTab` to capture the current tab, then crops and decodes the user-selected region.

## Development

### Internationalization

The extension uses Chrome's `_locales` mechanism to provide Chinese (`zh_CN`) and English (`en`) interfaces, with Chinese as the default language. When the browser UI language is English, the popup, manual selection panel, and error messages automatically appear in English.

When adding or changing copy, update both files:

```text
extension/_locales/zh_CN/messages.json
extension/_locales/en/messages.json
```

To regenerate the extension icons:

```bash
node tools/generate-icons.mjs
```

There is no build step. After changing files under `extension/`, refresh the extension on `chrome://extensions/`.

## Notes

- Chrome internal pages such as `chrome://` and the Chrome Web Store cannot inject content scripts.
- By default only visible image and canvas elements are scanned; CSS background images are handled by the automatic screenshot or manual selection fallback.
- To access local `file://` pages, enable "Allow access to file URLs" in the extension details.

## License

[MIT](LICENSE)
