# Flank EXE 安装器品牌素材

仅生成 NSIS EXE；`src-tauri/tauri.conf.json` 的 bundle.targets 已设为 nsis。

- 图源：根目录 `20260904-151355.png`；EXE 图标沿用 `../icons/icon.ico`。
- 图片内所有文字直接使用 `public/fonts/zcool-happy-2016.ttf`（HappyZcool-2016，站酷快乐体），无需系统安装字体。
- 文案参考 `website/index.html`；保留原生安装步骤、按钮字体、升级及用户数据处理逻辑。
- `nsis-sidebar.bmp`：164 × 314，欢迎/完成页侧图。
- `nsis-header.bmp`：150 × 57，安装页眉。
- 同名 PNG 用于实际尺寸预览，`@4x.png` 为高清原图；打包使用 24 位 RGB BMP。

项目根目录执行（推荐 PowerShell 7）：

```powershell
./scripts/generate-installer-art.ps1
npm run tauri -- build --bundles nsis
```

生成脚本使用 Windows System.Drawing，文字转轮廓后以四倍分辨率绘制再缩小。Windows PowerShell 5.1 运行含中文脚本需 UTF-8 BOM 编码。

之前生成的 wix 图片不再引用；已有 MSI 历史产物不代表本次打包输出。
