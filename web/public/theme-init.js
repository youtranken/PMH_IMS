// Đặt theme TRƯỚC khi React render để trang không chớp sáng/tối. Nằm ở file riêng chứ không
// inline trong index.html, để CSP chỉ cần `script-src 'self'` (OPS-04). Chỉ theme, không token.
// Quy ước phải khớp `src/lib/theme.ts`: không lưu gì = TỐI (Q-21); 'system' = theo máy.
(function () {
  var t = 'dark';
  try {
    var saved = localStorage.getItem('ims_theme');
    if (saved === 'dark' || saved === 'light') t = saved;
    else if (saved === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    // localStorage bị chặn (chế độ riêng tư, chính sách trình duyệt): vẫn dùng mặc định tối.
  }
  document.documentElement.dataset.theme = t;
})();
