# 本地 Chromium 渲染器

发布构建时，请将对应平台的 Chromium Headless Shell 文件放入此目录：

```text
chromium/
  win-x64/
    chrome-headless-shell.exe
    *.dll
    icudtl.dat
    locales/
```

开发环境可以设置 `NIUERY_CHROMIUM_PATH` 指向 `chrome-headless-shell.exe`。
渲染命令只读取本地 HTML，并通过禁用网络的参数生成 PDF。
