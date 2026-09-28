/**
 * Thanh mức sử dụng dùng chung (AD-15) — dải IP (FR-020, story 5.1), seat license, và về
 * sau là các ô trên bảng điều khiển (Epic 7).
 *
 * Tông màu đổi theo ngưỡng: đầy quá thì phải NHÌN LÀ THẤY, không phải đọc con số rồi tự so.
 * Mặc định 70/90 là quy ước ĐỌC (xanh/vàng/đỏ). Màn nào đã có ngưỡng nghiệp vụ trong
 * `system_config` (dải IP: `dashboard.subnet_full_percent`) thì truyền vào `warnAt`/`dangerAt`,
 * để thẻ dải và bảng điều khiển không nói hai câu khác nhau về cùng một dải (AD-11).
 */
export function usageTone(value: number, warnAt = 70, dangerAt = 90): 'ok' | 'warn' | 'danger' {
  return value >= dangerAt ? 'danger' : value >= warnAt ? 'warn' : 'ok';
}

export function UsageBar({
  percent,
  label,
  ariaLabel,
  showPercent = true,
  warnAt,
  dangerAt,
  marker,
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
  warnAt?: number;
  dangerAt?: number;
  /**
   * Vạch mốc (phần trăm) trên thanh + chữ giải thích khi rê chuột — vd ngưỡng "sắp đầy" của bảng
   * điều khiển: thanh đỏ 93% mà không thấy ngưỡng là 80 hay 90 thì không biết nó vượt bao xa.
   */
  marker?: { percent: number; label: string };
}) {
  // Kẹp lại phòng dữ liệu lệch: thanh tràn ra ngoài khung làm hỏng cả bảng.
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const tone = usageTone(value, warnAt, dangerAt);

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
        {/* Đã dùng mà chưa tới 1% vẫn phải thấy một vạch: dải có 1 IP khác hẳn dải trống trơn. */}
        <div
          className={`usage-fill${percent > 0 ? ' has-some' : ''}`}
          style={{ width: `${value}%` }}
        />
        {marker ? (
          <span
            className="usage-marker"
            style={{ left: `${Math.max(0, Math.min(100, marker.percent))}%` }}
            title={marker.label}
          />
        ) : null}
      </div>
      <span className="usage-text">
        {label && !showPercent ? label : label ? `${value}% · ${label}` : `${value}%`}
      </span>
    </div>
  );
}
