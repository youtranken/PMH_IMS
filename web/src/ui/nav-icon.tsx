/**
 * Icon cho từng mục sidebar (theo key i18n) — làm shell giống app-shell.html.
 * Key lạ → icon chấm tròn mặc định. Chỉ trình bày.
 */
const ICONS: Record<string, React.ReactNode> = {
  'nav.dashboard': (
    <>
      {/* Bốn ô — bảng điều khiển ba khối. */}
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  'nav.devices': (
    <>
      {/* Màn hình + chân đế — kho thiết bị. */}
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  'nav.software': (
    <>
      {/* Key — chìa/khoá license: phần mềm là license gán vào một tài sản. */}
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L21 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </>
  ),
  'nav.isp': (
    <>
      {/* Quả cầu — đường truyền ra Internet. */}
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18" />
    </>
  ),
  'nav.expiry': (
    <>
      {/* Đồng hồ — sắp hết hạn là chuyện thời gian. */}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  'nav.ipam': (
    <>
      {/* Sơ đồ mạng — một nút phát xuống hai nút. */}
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <path d="M12 8v4M5 16v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
    </>
  ),
  'nav.nat': (
    <>
      {/* Hai mũi tên ngược chiều — dịch địa chỉ trong ↔ ngoài. */}
      <path d="m8 3-4 4 4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  'nav.approvals': (
    <>
      {/* Ô có dấu tích — xin–duyệt. */}
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  'nav.vault': (
    <>
      {/* Ổ khóa — két sắt. */}
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </>
  ),
  'nav.documents': (
    <>
      {/* Tờ giấy gấp mép — tài liệu. */}
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  'nav.accounts': (
    <>
      {/* Hai người — tài khoản. */}
      <circle cx="9" cy="7" r="4" />
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.5a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-3.85" />
    </>
  ),
  'nav.catalog': (
    <>
      {/* Tags (nhãn phân loại) — hợp "Danh mục" (Loại/Hãng/Cấu hình) hơn hình hộp cũ. */}
      <path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19" />
      <path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="6.5" cy="9.5" r="1.1" />
    </>
  ),
  'nav.vaultAccess': (
    <>
      {/* Khiên có dấu tích — ma trận quyền là bản đồ phòng thủ. */}
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  'nav.auditLog': (
    <>
      {/* Đồng hồ quay ngược — nhật ký là nhìn lại quá khứ. */}
      <path d="M12 8v4l3 2" />
      <path d="M3.05 11a9 9 0 1 1 .5 4" />
      <path d="M3 4v4h4" />
    </>
  ),
  'nav.components': (
    <>
      {/* Khối lắp ghép — bộ giao diện dùng chung. */}
      <path d="m12 2 9 5v10l-9 5-9-5V7Z" />
      <path d="M12 12 3 7M12 12l9-5M12 12v10" />
    </>
  ),
};

export function NavIcon({ navKey }: { navKey: string }) {
  return (
    <svg
      className="nav-ic"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[navKey] ?? <circle cx="12" cy="12" r="4" />}
    </svg>
  );
}
