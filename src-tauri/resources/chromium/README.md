# 本地 Chromium 渲染器

HTML / Markdown 导出 PDF、PNG 需要 Chromium Headless Shell。二进制约 270MB，不纳入 Git。

开发者显式运行 `npm run prepare:chromium` 时，会准备到：

```text
chromium/
  win-x64/
    chrome-headless-shell.exe
    *.dll
    icudtl.dat
    locales/
```

`npm install`、开发启动和桌面构建不再自动下载或捆绑该目录。正式用户在「设置 → 资源管理」按需下载或离线导入；也可复用通过 PDF/PNG 兼容性检查的 Edge / Chrome。开发环境可以设置 `NIUERY_CHROMIUM_PATH` 指向本地浏览器。

渲染在本机执行，使用隔离的临时 profile；应用不把文档上传到远程渲染服务。浏览器后台联网功能被禁用，但用户 HTML 自身引用的远程图片/字体仍可能请求网络，不应将这些参数视作网络沙箱。
