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
 * Một KHU CÓ TÊN ở cột chính — bản anh em của `RailCard` cho nửa bên trái.
 *
 * VÌ SAO NÓ RA ĐỜI (19/09/2026). Khu "Hồ sơ" thêm ngày 19/09 được chép NGUYÊN VĂN vào bốn file
 * `features/` — cùng `<section className="card device-panel" id="sec-ho-so" aria-labelledby=…>`,
 * cùng `<h2 className="form-section-title">`, từng ký tự. Đó là fork bản sao, thứ AD-15 cấm
 * thẳng ("cần khác đi thì thêm prop, CẤM copy ra bản riêng"), và `RailCard` ngay trên đây đã là
 * khuôn mẫu sẵn có cho cột phải — cột trái chỉ thiếu bản của mình. Hậu quả đo được ngay: đổi
 * một chi tiết phải sửa bốn chỗ, và hai khiếm khuyết trình bày của khu ấy cũng phải vá bốn lần.
 *
 * `useId` thay cho `id="sec-ho-so"` gõ tay: id gõ tay chỉ an toàn chừng nào không màn nào vẽ
 * hai khu cùng lúc — một điều kiện không ai cưỡng chế được, và ngày nó vỡ thì `aria-labelledby`
 * trỏ nhầm trong im lặng.
 *
 * `compact` = dùng cho màn mà các khu ANH EM của nó đã là `device-panel` (hiện chỉ trang chi
 * tiết thiết bị). Ở đó khu này phải bó đúng bằng hàng xóm; ở ba màn còn lại nó đứng một mình
 * trong cột chính, và thứ để mắt so sánh là thẻ định danh bên phải — nên `.card` trần mới là
 * bản khớp. Đừng đặt `compact` "cho đều": nó đang nói một điều CÓ THẬT về màn đang vẽ.
 */
export function DetailSection({
  title,
  children,
  compact,
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <section className={compact ? 'card device-panel' : 'card'} aria-labelledby={id}>
      <h2 className="form-section-title" id={id}>
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
  /*
   * KHÔNG CÓ `value` NHƯNG CÓ `note` THÌ VẪN PHẢI VẼ (18/09/2026).
   *
   * Bản trước trả `null` ngay khi `value` rỗng, và thế là nuốt luôn cả `note`. Mà `note` đang
   * là chỗ DUY NHẤT vài trường tồn tại trên trang đọc: `department` chỉ xuất hiện dưới dạng
   * chú của dòng "Người dùng" / "Người phụ trách".
   *
   * Cảnh hỏng: một máy đã gán cho phòng Kế toán nhưng chưa ghi tên người dùng cụ thể. Trang
   * chi tiết KHÔNG hiện bộ phận ở bất cứ đâu — và `BlankFields` cũng bỏ qua nó, vì
   * `item.department` CÓ giá trị nên nó không nằm trong danh sách "Chưa khai". Giá trị có
   * trong DB, có trong form sửa, chỉ trang đọc là không.
   *
   * Vẽ ô với `value` rỗng thì dòng chú đứng một mình dưới nhãn — vẫn đọc được, và vẫn đúng
   * luật "không vẽ ô RỖNG": ô này không rỗng, nó có nội dung, chỉ là nội dung nằm ở `note`.
   *
   * Lớp ternary ở nơi gọi (`device-detail`, `service-account-detail`) KHÔNG phải bản chép của
   * phép canh này — nó chọn cái NHÃN: có người phụ trách thì bộ phận là chú của dòng ấy, không
   * có thì bộ phận đứng thành dòng riêng mang đúng nhãn của nó. Gỡ nó đi vì tưởng trùng lặp là
   * mất lại đúng lỗi mà cả hai chỗ sinh ra để vá.
   */
  if (!value && !note) return null;
  return (
    <RailRow label={label} note={note}>
      {value}
    </RailRow>
  );
}
