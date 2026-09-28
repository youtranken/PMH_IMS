import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Hàng số ở đầu màn — MỘT CON SỐ TO, ĐỌC ĐƯỢC TỪ XA, VÀ BẤM ĐƯỢC.
 *
 * VÌ SAO LÀ TÀI SẢN DÙNG CHUNG (AD-15). Ra đời ở Bảng điều khiển 17/09/2026, rồi màn "Sắp hết
 * hạn" cần đúng hình dạng ấy: ba con số tổng kết vốn nằm trong ba cái pill 11px cạnh nhau, đọc
 * được thì phải dí mắt vào. Hai màn = tài sản dùng chung, không copy DOM lần thứ hai.
 *
 * HAI KIỂU Ô, cùng một hình:
 *   · `to` — ô là một LINK, bấm là sang màn đầy đủ (Bảng điều khiển dùng kiểu này);
 *   · `onClick` + `active` — ô là một NÚT LỌC, bấm là thu hẹp chính bảng bên dưới (màn Sắp hết
 *     hạn dùng kiểu này). `aria-pressed` nói cho trình đọc màn hình biết đang bật hay tắt.
 *
 * LUẬT TÔ MÀU, giữ đúng thì hàng số mới còn nghĩa: chỉ tô ô nào ĐANG CÓ VIỆC PHẢI LÀM, và số 0
 * thì KHÔNG BAO GIỜ tô — "không có gì" là tin tốt, tô vàng lên là báo động giả. Tô cả hàng thì
 * mắt không còn thứ tự nào để đọc.
 */
export type KpiTone = 'warn' | 'danger';

/**
 * `dense`: trên điện thoại giữ cả hàng trên MỘT dòng (ô nhỏ, số nhỏ hơn). Dùng khi hàng chỉ có
 * vài ô lọc ngang hàng — ô lẻ rơi xuống dòng riêng trông như một khối khác nghĩa.
 */
export function KpiStrip({ children, dense = false }: { children: ReactNode; dense?: boolean }) {
  return <div className={dense ? 'dash-kpis kpi-dense' : 'dash-kpis'}>{children}</div>;
}

export function KpiTile({
  value,
  label,
  tone,
  to,
  onClick,
  active,
  incomplete,
}: {
  value: number;
  label: string;
  /** Chỉ truyền khi con số này nghĩa là "có việc phải làm". Số 0 tự bỏ qua tone. */
  tone?: KpiTone;
  to?: string;
  onClick?: () => void;
  active?: boolean;
  /**
   * Con số có thể THIẾU (một nguồn dữ liệu lỗi): hiện "7+" và câu này làm tooltip. Không được
   * để con số thiếu trông y hệt con số đủ.
   */
  incomplete?: string;
}) {
  /*
   * TÊN LỚP CÓ TIỀN TỐ `kpi-`, không dùng trần `warn`/`danger`.
   *
   * Ô số là một `<button>`, mà `css/base.css` có sẵn `button.danger { background: var(--danger) }`
   * cho nút phá hủy. Đặt class trần thì ô "Gấp (≤7 ngày)" bị tô nguyên nền ĐỎ như một cái nút
   * xóa — bài kiểm tương phản sáng/tối bắt được đúng chuyện đó (chữ #a5271b trên nền #c0392b,
   * tỉ lệ 1.33). Một con số thống kê không được trông như một nút phá hủy.
   */
  const className = [
    'kpi',
    value > 0 && tone ? `kpi-${tone}` : '',
    value === 0 ? 'zero' : '',
    active ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      <span className="kpi-n">
        {value}
        {incomplete ? '+' : null}
      </span>
      <span className="kpi-l">{label}</span>
    </>
  );

  if (to) {
    return (
      <Link className={className} to={to} title={incomplete}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-pressed={active}
      title={incomplete}
    >
      {inner}
    </button>
  );
}
