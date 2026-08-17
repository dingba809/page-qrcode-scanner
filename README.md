# Page QR Code Scanner

English: [README.en.md](README.en.md)

一个 Manifest V3 Chrome 扩展，用于扫描当前网页中的二维码，并提取其中的文本或 URL。当页面存在多个二维码时，可以在弹窗中手动选择后复制或打开；也可以手动框选屏幕区域进行识别。

## 功能

- 自动扫描当前页面可见的 `<img>` 和 `<canvas>`。
- 遍历开放 Shadow DOM，兼容 Web Components 中的二维码。
- 页面元素中未找到二维码时，自动截取当前可见屏幕再次识别。
- 单个图片包含多个二维码时，会依次屏蔽已识别区域并继续检测。
- 支持手动框选网页区域，识别结果显示在网页右下角。
- 自动识别 URL 并支持一键打开；非 URL 文本仍可复制。
- 全程使用本地 `jsQR` 解码，不依赖后端服务。
- 支持中文和英文界面，根据浏览器语言自动切换。

## 目录结构

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

## 安装

1. 克隆仓库：

   ```bash
   git clone https://github.com/dingba809/page-qrcode-scanner.git
   ```

2. 打开 Chrome，进入 `chrome://extensions/`。
3. 开启右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」。
5. 选择仓库中的 `extension` 目录。

## 使用

1. 打开包含二维码的网页。
2. 点击浏览器工具栏中的扩展图标。
3. 扩展会自动扫描当前页面。
4. 如果有多个二维码，点击目标二维码进行选择，然后点击「复制选中」或「打开选中」。

手动框选识别：

1. 点击扩展弹窗右上角的「框选识别」。
2. 在网页上拖拽框选二维码区域。
3. 识别结果会显示在网页右下角，可复制或打开。

## 权限说明

- `clipboardWrite`：用于将识别结果复制到剪贴板。
- `<all_urls>`：用于抓取页面中的跨域图片，并在手动框选时截取当前可见标签页。

扩展不会将页面数据上传到任何远程服务，二维码解码在浏览器本地完成。

## 工作原理

- 内容脚本扫描普通 DOM 与开放 Shadow DOM 中的 `<img>`、`<canvas>`。
- 跨域图片由后台 Service Worker 抓取后转交给内容脚本解码。
- 解码使用内置 `jsQR`，并支持从单个图片中检测多个二维码。
- 手动框选模式使用 `chrome.tabs.captureVisibleTab` 截取当前标签页，再按用户框选区域裁剪解码。

## 开发

### 国际化

扩展通过 Chrome `_locales` 机制提供中文（`zh_CN`）和英文（`en`）两种界面语言，默认语言为中文。浏览器界面语言为英文时，弹窗、手动框选面板及错误提示会自动显示为英文。

新增或修改文案时，需要同步更新以下两个文件：

```text
extension/_locales/zh_CN/messages.json
extension/_locales/en/messages.json
```

重新生成扩展图标：

```bash
node tools/generate-icons.mjs
```

本项目无构建步骤，修改 `extension/` 下的文件后，在 `chrome://extensions/` 中刷新扩展即可。

## 注意事项

- Chrome 内部页面（如 `chrome://`、Chrome 应用商店页面）无法注入内容脚本。
- 默认只扫描可见的图片和画布元素；CSS 背景图会由自动截图或手动框选兜底。
- 访问本地 `file://` 页面时，需要在扩展详情中开启「允许访问文件网址」。

## License

[MIT](LICENSE)
