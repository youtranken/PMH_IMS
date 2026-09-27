// Đặt theme TRƯỚC khi React render để trang không chớp sáng/tối. Nằm ở file riêng chứ không
// inline trong index.html, để CSP chỉ cần `script-src 'self'` (OPS-04). Chỉ theme, không token.
(function () {
  try {
    var t = localStorage.getItem('ims_theme');
    if (t !== 'dark' && t !== 'light') {
      t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
