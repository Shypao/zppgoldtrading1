/* Render a session-only receipt at an ordinary HTTPS URL for Android printing. */
(async function () {
  const status = document.getElementById('receipt-print-status');
  try {
    const payload = JSON.parse(sessionStorage.getItem('zp_thermal_receipt_print') || 'null');
    if (!payload || typeof payload.html !== 'string' || !Number.isFinite(payload.createdAt) ||
        Date.now() - payload.createdAt > 600000 || /<script\b/i.test(payload.html)) {
      throw new Error('Missing receipt');
    }
    const receipt = new DOMParser().parseFromString(payload.html, 'text/html');
    const main = receipt.querySelector('main.thermal-receipt');
    const style = receipt.querySelector('style');
    const tools = receipt.querySelector('.receipt-print-tools');
    if (!main || !style || !tools) throw new Error('Invalid receipt');
    document.title = receipt.title;
    document.querySelector('meta[name="viewport"]').content = receipt.querySelector('meta[name="viewport"]').content;
    document.head.appendChild(document.importNode(style, true));
    document.body.replaceChildren(document.importNode(main, true), document.importNode(tools, true));
    await (document.fonts?.ready || Promise.resolve());
    window.setTimeout(() => window.print(), 100);
  } catch {
    status.textContent = 'Receipt unavailable. Return to the software and open Print receipt again.';
  }
})();
