import { Chevron } from '@/ui/chevron';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/**
 * Đầu MỌI trang chi tiết (AD-15): breadcrumb → mã + tên → dòng định danh → nút thao tác.
 *
 * Vì sao thay `PageHeader` ở riêng mấy trang này: với `PageHeader`, trang chi tiết xếp BỐN tầng
 * điều hướng trước khi tới nội dung — sidebar, topbar, hàng nút có "Về danh sách", rồi thanh
 * tab. Không breadcrumb nào nói đang đứng ở đâu, mà lại có hai đường quay ra.
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
   * Mã hồ sơ — hiện cỡ lớn, dạng `mono`. KHÔNG kèm nút chép.
   *
   * Mã đang là TIÊU ĐỀ của trang, và tiêu đề thì người ta bôi đen chép như mọi chữ khác. Cái
   * nút nhỏ nhét giữa mã và tên làm hàng tiêu đề gãy làm ba mảnh mà đổi lại gần như không ai
   * bấm — khác hẳn nút chép ở serial / IP WAN / tài khoản đăng nhập, những giá trị người ta
   * dán thẳng vào terminal và gõ tay thì sai. Mấy nút đó GIỮ NGUYÊN.
   *
   * Trang không có mã hồ sơ (phiếu duyệt) thì bỏ trống: `name` lên làm tiêu đề cỡ lớn.
   */
  code?: string;
  name?: string | null;
  /** Dòng định danh kỹ thuật dưới tiêu đề (loại · model · serial…). */
  subline?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="detail-head">
      {/*
        Mục ĐẦU TIÊN vừa là breadcrumb vừa là đường QUAY LẠI, và nó phải trông ra một cái nút.
        Để cả hàng cùng một màu xám nhạt thì người dùng nhìn không ra chỗ nào bấm được và báo
        là "mất nút quay về danh sách" — đúng, vì một cái link không trông giống link
        thì nó không tồn tại.
      */}
      <nav className="crumbs" aria-label="breadcrumb">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="crumb">
            {index > 0 ? (
              <Chevron direction="right" className="crumb-sep" />
            ) : null}
            {crumb.to ? (
              <Link className={index === 0 ? 'crumb-back' : undefined} to={crumb.to}>
                {index === 0 ? <Chevron direction="left" className="crumb-arrow" /> : null}
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
            {code ? <span className="mono">{code}</span> : null}
            {name ? <span className={code ? 'detail-name' : undefined}>{name}</span> : null}
          </h1>
          {subline ? <div className="detail-subline">{subline}</div> : null}
        </div>
        {actions ? <div className="detail-actions">{actions}</div> : null}
      </div>
    </header>
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
  const { t } = useTranslation();
  if (labels.length === 0) return null;
  return <p className="blank-fields muted">{t('detail.blankFields', { list: labels.join(', ') })}</p>;
}

/**
 * Một ô của lưới `data-grid`, và CHỈ vẽ khi có giá trị.
 *
 * Vẽ cả ô `Model: —` trong lưới lẫn "Chưa khai: Model…" của `BlankFields` ngay dưới là hai
 * lần cho một sự thật, mà lần đầu trông như dữ liệu hỏng chứ không phải việc còn thiếu.
 *
 * Luật: có giá trị thì vào lưới, không có thì vào một dòng duy nhất bên dưới.
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
