/**
 * Thanh mức sử dụng dùng chung (AD-15) — dải IP (FR-020, story 5.1), seat license, và về
 * sau là các ô trên bảng điều khiển (Epic 7).
 *
 * Tông màu đổi theo ngưỡng: đầy quá thì phải NHÌN LÀ THẤY, không phải đọc con số rồi tự so.
 * Ngưỡng cố định 70/90 là có chủ ý — đây là quy ước ĐỌC (xanh/vàng/đỏ), không phải tham số
 * vận hành của nghiệp vụ, nên không thuộc `system_config` (AD-11).
 */
export function UsageBar({
  percent,
  label,
  ariaLabel,
  showPercent = true,
}: {
  percent: number;
  /** Chữ hiện cạnh thanh, vd "127/254 · còn 127". Bỏ trống thì chỉ hiện %. */
  label?: string;
  ariaLabel?: string;
  /**
   * `false`: chỉ in `label`. Dùng khi nhãn đã là phân số ("3/3") — thanh đo nói tỉ lệ rồi, in
   * thêm "100% · " chỉ làm chữ dài ra và tràn sang cột bên (cột Ghế ở danh sách phần mềm).
   */
  showPercent?: boolean;
}) {
  // Kẹp lại phòng dữ liệu lệch: thanh tràn ra ngoài khung làm hỏng cả bảng.
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const tone = value >= 90 ? 'danger' : value >= 70 ? 'warn' : 'ok';

  return (
    <div className="usage">
      <div
        className={`usage-track tone-${tone}`}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        <div className="usage-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="usage-text">
        {label && !showPercent ? label : label ? `${value}% · ${label}` : `${value}%`}
      </span>
    </div>
  );
}
