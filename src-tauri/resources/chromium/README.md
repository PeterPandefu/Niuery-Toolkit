# 本地 Chromium 渲染器

HTML / Markdown 导出 PDF、PNG 需要 Chromium Headless Shell。二进制约 270MB，不纳入 Git。

克隆仓库后执行 `npm install`，或运行 / 打包桌面应用时，会自动准备到：

```text
chromium/
  win-x64/
    chrome-headless-shell.exe
    *.dll
    icudtl.dat
    locales/
```

也可手动执行 `npm run prepare:chromium`。开发环境可以设置 `NIUERY_CHROMIUM_PATH` 指向 `chrome-headless-shell.exe`。不需要这份资源时，设置 `NIUERY_SKIP_CHROMIUM=1` 可跳过安装阶段的下载（打包仍会检查）。

渲染命令只读取本地 HTML，并通过禁用网络的参数生成 PDF。
