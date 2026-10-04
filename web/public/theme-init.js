// Đặt theme TRƯỚC khi React render để trang không chớp sáng/tối. Nằm ở file riêng chứ không
// inline trong index.html, để CSP chỉ cần `script-src 'self'` (OPS-04). Chỉ theme, không token.
// Quy ước phải khớp `src/lib/theme.ts`: không lưu gì = SÁNG (Q-21); 'system' = theo máy.
// Cùng chỗ đặt `data-motion` (khớp `src/lib/motion.ts`): luật CSS "giảm chuyển động" khoá theo nó,
// đặt muộn thì hiệu ứng lúc tải trang chạy sai lựa chọn.
(function () {
  var t = 'light';
  try {
    var saved = localStorage.getItem('ims_theme');
    if (saved === 'dark' || saved === 'light') t = saved;
    else if (saved === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    // localStorage bị chặn (chế độ riêng tư, chính sách trình duyệt): vẫn dùng mặc định sáng.
  }
  document.documentElement.dataset.theme = t;
  try {
    var m = localStorage.getItem('ims_motion');
    if (m === 'on' || m === 'off') document.documentElement.dataset.motion = m;
  } catch {
    // kho bị chặn: theo hệ thống.
  }
})();
