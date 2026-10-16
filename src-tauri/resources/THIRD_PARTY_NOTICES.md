# Bundled recording dependencies

This directory bundles the Windows x64 LGPL shared FFmpeg build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), release asset
`ffmpeg-master-latest-win64-lgpl-shared.zip`, built 2026-08-02.

The build's runtime files are `ffmpeg.exe` and the accompanying `*.dll` files in this
directory. Its full GNU LGPL v3 text is included as `LICENSE.txt`. Corresponding build
recipes and source availability are published by BtbN at
https://github.com/BtbN/FFmpeg-Builds and by FFmpeg at https://ffmpeg.org/download.html.

The recorder uses `rawvideo`, `aac`, `palettegen`, and `paletteuse`; it prefers
software H.264 (`libx264` if provided by an external installation, otherwise
`libopenh264`) and falls back to Windows Media Foundation `h264_mf`. The project's
LGPL resource pack does not require or distribute GPL x264.

## Optional OCR resource packs

Tesseract.js 7 and tesseract.js-core are distributed under Apache-2.0. Their full
license texts accompany each generated OCR pack under `licenses/`. Traineddata
files are from the Tesseract tessdata project, Apache-2.0:
https://github.com/tesseract-ocr/tessdata . The original local model bytes are
preserved; publishing resource packs requires checking their upstream provenance
and corresponding license/source obligations before release.

## simple-mind-map

思维导图功能使用 [wanglin2/mind-map](https://github.com/wanglin2/mind-map)
的 `simple-mind-map` 0.14.0-fix.3 核心库。该库采用 MIT 许可证；本应用只注册本地
编辑和导出功能，未注册其协同插件或任何网络服务。

```
The MIT License (MIT)

Copyright (c) 2021-2023 The MindMap Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
