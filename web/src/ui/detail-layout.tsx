import { useId, type ReactNode } from 'react';

/**
 * Bố cục hai cột của MỌI trang chi tiết (AD-15): nội dung bên trái, thẻ định danh bên phải.
 *
 * VÌ SAO THAY `StatGrid`. Dải chỉ số ngang dùng `auto-fit, minmax(180px, 1fr)`, nghĩa là bề
 * ngang mỗi ô phụ thuộc vào SỐ chỉ số vẽ được. Hồ sơ khai sơ sài — tức đa số hồ sơ — chỉ còn
 * hai chỉ số, và hai cái ô phình ra nửa màn hình để chứa chữ "Dự phòng". Cột phải rộng cố
 * định thì bề ngang không còn phụ thuộc dữ liệu.
 *
 * Và nó DÍNH khi cuộn: thứ người trực cần lúc đang đứng cạnh tủ rack — mã, vị trí, trạng
 * thái, còn bao nhiêu ngày bảo hành — không trôi mất khi cuộn xuống đọc bảng port map.
 *
 * LUẬT CHIA VIỆC (giữ đúng thì không bao giờ có chuyện in hai lần một giá trị):
 *   · cột phải = "cái này là gì, ở đâu, của ai, còn hạn không" — thuộc tính của chính hồ sơ;
 *   · cột chính = "nó dính tới cái gì, đã xảy ra chuyện gì" — quan hệ, bảng, lịch sử.
 * Một trường đã nằm ở cột phải thì KHÔNG lặp lại ở lưới bên trái. Đó chính là lỗi của bản
 * trước: trạng thái, bảo hành, nhà cung cấp in ở hai chỗ cách nhau 40px.
 *
 * Dưới 1199px: một cột, và cột phải nhảy LÊN TRƯỚC (`order: -1` trong `css/detail-tabs.css`).
 */
export function DetailLayout({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="detail-2col">
      <div className="detail-main">{children}</div>
      <aside className="detail-rail">{rail}</aside>
    </div>
  );
}

/**
 * Thẻ định danh. `title` mặc định để mọi trang gọi cùng một tên, khỏi mỗi nơi một kiểu.
 *
 * LÀ MỘT KHU CÓ TÊN, không phải một cái hộp (sửa 17/09/2026). Bản đầu dựng tiêu đề bằng một
 * `<div class="rail-h">` — nhìn thì y hệt, nhưng với trình đọc màn hình nó chỉ là chữ trôi
 * giữa trang: không nhảy tới được, không biết mấy dòng dưới thuộc về nó.
 *
 * Thẻ này lại đang giữ đúng những thứ người ta cần gấp nhất (mã, vị trí, trạng thái, còn bao
 * nhiêu ngày bảo hành/hạn), và từ đợt dựng lại thì hạn CHỈ còn ở đây — cột chính không vẽ lại
 * nữa. Một khu quan trọng đến thế mà không có tên thì đường vào duy nhất là nghe hết cả trang.
 */
export function RailCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="rail-card" aria-labelledby={id}>
      <h2 className="rail-h" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Một dòng của thẻ định danh: nhãn · giá trị · chú thích.
 *
 * `children` cho phép nhét cả huy hiệu hay thanh hạn vào chỗ giá trị — `WarrantyTimeline`
 * đứng ở đây là đúng chỗ, và nhờ vậy trang không còn thẻ "Bảo hành" thứ hai ở cột chính.
 */
export function RailRow({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="rail-row">
      <span className="rail-k">{label}</span>
      <span className="rail-v">{children}</span>
      {note ? <span className="rail-note">{note}</span> : null}
    </div>
  );
}

/**
 * Chỉ vẽ dòng khi CÓ giá trị — thẻ "NHÀ CUNG CẤP: —" là một dòng chết trong một cột chỉ có
 * chừng sáu dòng. Khác `orDash` ở lưới bên trái: dưới đó một ô rỗng còn nói được "trường này
 * tồn tại, chưa ai khai", còn ở đây nó chỉ tốn chỗ.
 */
export function RailRowIfSet({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null | undefined;
  note?: ReactNode;
}) {
  if (!value) return null;
  return (
    <RailRow label={label} note={note}>
      {value}
    </RailRow>
  );
}
