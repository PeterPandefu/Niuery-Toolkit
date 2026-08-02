# Bundled recording dependencies

This directory bundles the Windows x64 LGPL shared FFmpeg build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), release asset
`ffmpeg-master-latest-win64-lgpl-shared.zip`, built 2026-08-02.

The build's runtime files are `ffmpeg.exe` and the accompanying `*.dll` files in this
directory. Its full GNU LGPL v3 text is included as `LICENSE.txt`. Corresponding build
recipes and source availability are published by BtbN at
https://github.com/BtbN/FFmpeg-Builds and by FFmpeg at https://ffmpeg.org/download.html.

The recorder uses `rawvideo`, `aac`, `palettegen`, and `paletteuse`; it prefers the
Windows Media Foundation `h264_mf` encoder and falls back to `mpeg4`. It deliberately
does not require GPL encoders such as x264.
