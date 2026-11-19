(function () {
  var scheduled = 0;
  function measure() {
    var root = document.documentElement;
    var body = document.body;
    var width = Math.max(root.scrollWidth, body ? body.scrollWidth : 0);
    var nodes = body ? body.querySelectorAll('*') : [];
    for (var index = 0; index < nodes.length; index += 1) {
      var rect = nodes[index].getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) width = Math.max(width, rect.right + window.scrollX);
    }
    return Math.ceil(width);
  }
  function report() {
    scheduled = 0;
    window.parent.postMessage({ type: 'niuery-html-preview-metrics', width: measure() }, '*');
  }
  function schedule() {
    if (scheduled) return;
    scheduled = window.requestAnimationFrame(report);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(document.documentElement);
  if (window.MutationObserver && document.body) {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  }
  window.setTimeout(schedule, 300);
  window.setTimeout(schedule, 1200);
})();