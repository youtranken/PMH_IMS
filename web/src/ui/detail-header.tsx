import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Đầu MỌI trang chi tiết (AD-15): breadcrumb → mã + tên → dòng định danh → nút thao tác.
 *
 * Vì sao thay `PageHeader` ở riêng mấy trang này: trang chi tiết trước đây xếp BỐN tầng điều
 * hướng trước khi tới nội dung — sidebar, topbar, hàng nút có "Về danh sách", rồi thanh tab.
 * Không breadcrumb nào nói đang đứng ở đâu, mà lại có hai đường quay ra.
 *
 * Breadcrumb gánh luôn việc của nút "Về danh sách" và nói thêm được bối cảnh ("Thiết bị ›
 * Switch › SW-CORE-01"), nên bốn tầng rút còn ba.
 */
export interface Crumb {
  label: string;
  /** Không có `to` = mục cuối, chính trang đang đứng. */
  to?: string;
}

export function DetailHeader({
  crumbs,
  code,
  name,
  subline,
  actions,
}: {
  crumbs: Crumb[];
  /**
   * Mã hồ sơ — hiện cỡ lớn, dạng `mono`. KHÔNG kèm nút chép (bỏ 28/08/2026).
   *
   * Mã đang là TIÊU ĐỀ của trang, và tiêu đề thì người ta bôi đen chép như mọi chữ khác. Cái
   * nút nhỏ nhét giữa mã và tên làm hàng tiêu đề gãy làm ba mảnh mà đổi lại gần như không ai
   * bấm — khác hẳn nút chép ở serial / IP WAN / tài khoản đăng nhập, những giá trị người ta
   * dán thẳng vào terminal và gõ tay thì sai. Mấy nút đó GIỮ NGUYÊN.
   */
  code: string;
  name?: string | null;
  /** Dòng định danh kỹ thuật dưới tiêu đề (loại · model · serial…). */
  subline?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="detail-head">
      {/*
        Mục ĐẦU TIÊN vừa là breadcrumb vừa là đường QUAY LẠI, và nó phải trông ra một cái nút.
        Bản trước để cả hàng cùng một màu xám nhạt: người dùng nhìn không ra chỗ nào bấm được
        và báo là "mất nút quay về danh sách" — đúng, vì một cái link không trông giống link
        thì nó không tồn tại.
      */}
      <nav className="crumbs" aria-label="breadcrumb">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="crumb">
            {index > 0 ? (
              <span className="crumb-sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            {crumb.to ? (
              <Link className={index === 0 ? 'crumb-back' : undefined} to={crumb.to}>
                {index === 0 ? (
                  <span aria-hidden="true" className="crumb-arrow">
                    ‹
                  </span>
                ) : null}
                {crumb.label}
              </Link>
            ) : (
              <span>{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="detail-title-row">
        <div className="detail-title-main">
          <h1 className="detail-code">
            <span className="mono">{code}</span>
            {name ? <span className="detail-name">{name}</span> : null}
          </h1>
          {subline ? <div className="detail-subline">{subline}</div> : null}
        </div>
        {actions ? <div className="detail-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * Dải chỉ số đầu trang — bốn thứ cần biết trong hai giây khi đang đứng xử lý sự cố.
 *
 * Mỗi trang chọn bốn chỉ số RIÊNG của mình: thiết bị là trạng thái/bảo hành/vị trí/người dùng,
 * đường truyền là hotline/trạng thái/hợp đồng/cước, phần mềm là hạn/ghế/chi phí/phụ trách.
 *
 * Thứ đã nằm ở đây thì BỎ khỏi lưới thông tin bên dưới. Bản trước lặp cả hai chỗ: badge trạng
 * thái và badge hạn xuất hiện ở dải tóm tắt rồi lặp y hệt trong lưới cách đó 40px.
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function Stat({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-k">{label}</span>
      <span className="stat-v">{children}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </div>
  );
}

/**
 * Chỉ vẽ thẻ khi CÓ nội dung — thẻ "NHÀ CUNG CẤP: — / —" là một ô chết chiếm đúng chỗ của
 * một chỉ số có ích, và dải chỉ số chỉ có bốn chỗ.
 *
 * Khác `orDash` ở lưới bên dưới: dưới đó một ô rỗng vẫn nói lên điều gì đó ("trường này tồn
 * tại, chưa ai khai"), còn trên dải chỉ số thì nó chỉ tốn chỗ.
 */
export function StatIfSet({
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
    <Stat label={label} note={note}>
      {value}
    </Stat>
  );
}

/**
 * Một dòng gom mọi ô CHƯA KHAI, thay cho một dãy hộp chỉ chứa dấu gạch ngang.
 *
 * Hồ sơ khai sơ sài thì lưới cũ hiện 8/13 ô là dấu `—`, và cả trang trông như dữ liệu hỏng —
 * trong khi sự thật chỉ là mấy trường đó chưa ai điền. Gom lại một dòng thì vừa gọn, vừa nói
 * đúng: đây là việc còn thiếu, không phải lỗi.
 */
export function BlankFields({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return <p className="blank-fields muted">Chưa khai: {labels.join(', ')}.</p>;
}

/**
 * Một ô của lưới `data-grid`, và CHỈ vẽ khi có giá trị.
 *
 * Sinh ra 16/09/2026 vì bản cũ làm cả hai việc cùng lúc: lưới vẽ ô `Model: —`, rồi ngay dưới
 * `BlankFields` lại viết "Chưa khai: Model…". Hai lần cho một sự thật, mà lần đầu trông như
 * dữ liệu hỏng chứ không phải việc còn thiếu. Chú thích của `BlankFields` nói đúng ý định —
 * gom ô trống về một dòng — nhưng không ai gỡ mấy cái ô trống đi, nên nó thành CỘNG THÊM.
 *
 * Từ nay: có giá trị thì vào lưới, không có thì vào một dòng duy nhất bên dưới.
 */
export function DataItemIfSet({
  label,
  value,
  children,
}: {
  label: string;
  /** Thứ quyết định vẽ hay không. `children` là cách hiển thị (mono, nút chép, huy hiệu…). */
  value: string | null | undefined;
  children?: ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="data-item">
      <dt>{label}</dt>
      <dd>{children ?? value}</dd>
    </div>
  );
}
