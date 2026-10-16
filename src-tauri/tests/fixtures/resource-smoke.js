/* Native WebView2 smoke fixture; invoked only by the explicit Rust example. */
import { invoke } from '@tauri-apps/api/core';
import { createOcrWorker } from '/src/tools/graphic/image-studio/ocr-engine.ts';
const report = { userAgent: navigator.userAgent, cases: [], errors: [] };
const status = document.getElementById('status');
window.addEventListener('securitypolicyviolation', event => report.errors.push(`CSP: ${event.violatedDirective} ${event.blockedURI}`));
try {
  report.setup = await invoke('prepare_smoke');
  for (const [language, text] of [['eng', 'Hello Niuery 123'], ['chi_sim', '文字识别测试'], ['chi_sim+eng', 'Hello 世界 123']]) {
    status.textContent = `Recognizing ${language} using managed packs, no external network…`;
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 180;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 180);
    ctx.fillStyle = 'black'; ctx.font = '64px "Microsoft YaHei", Arial'; ctx.fillText(text, 35, 110);
    document.body.appendChild(canvas);
    const worker = await createOcrWorker(language, (phase, progress) => { status.textContent = `${language}: ${phase} ${Math.round(progress * 100)}%`; });
    try {
      const result = await worker.recognize(canvas);
      const recognized = result.data.text.replace(/\s/g, '');
      const expected = text.replace(/\s/g, '');
      report.cases.push({ language, text, recognized, passed: recognized === expected });
    } finally { await worker.terminate(); }
  }
} catch (error) { report.errors.push(String(error)); }
report.success = report.cases.length === 3 && report.cases.every(item => item.passed) && report.errors.length === 0;
status.textContent = JSON.stringify(report, null, 2);
await invoke('finish_smoke', { result: JSON.stringify(report, null, 2), success: report.success });
