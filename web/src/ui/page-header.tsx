import type { ReactNode } from 'react';

/**
 * Đầu trang dùng chung (AD-15): tiêu đề + mô tả + vùng thao tác bên phải.
 * Mọi màn dùng cùng khoảng cách, cùng cỡ chữ — không màn nào tự dựng <h1> riêng.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="grow">
        <h1>{title}</h1>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

/**
 * Khối form có tiêu đề nhỏ (FORM SECTION) — dùng cho mọi form nhập liệu.
 * Style đã có sẵn trong css/form-layout.css.
 */
export function FormSection({
  title,
  children,
  columns = 3,
}: {
  /**
   * Tiêu đề khu. BỎ TRỐNG khi khu chỉ có một ô mà nhãn ô đã nói đúng điều đó — form tài khoản
   * dịch vụ từng in "Ghi chú" hai lần chồng nhau, cách nhau 8px, vì tiêu đề khu và nhãn ô là
   * cùng một chữ (rà UI/UX 12/09, mục #35).
   *
   * Không bỏ trống chỉ để cho gọn: khu có từ hai ô trở lên thì tiêu đề là thứ nói cho người
   * đọc biết mấy ô ấy thuộc về nhau.
   */
  title?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <section className="form-section">
      {title ? <h2 className="form-section-title">{title}</h2> : null}
      <div className="form-grid" data-columns={columns}>
        {children}
      </div>
    </section>
  );
}

/** Một ô nhập có nhãn — gói lại để nhãn/khoảng cách/aria nhất quán toàn app. */
export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  span,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  span?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <div className={`field${span ? ` span-${span}` : ''}`}>
      <label className="lbl-t" htmlFor={htmlFor}>
        {label}{' '}
        {/* Dấu * chỉ là chỉ dấu thị giác: aria-hidden để tên gọi trợ năng của ô nhập là
            đúng nhãn ("Email"), không thành "Email *". Bắt buộc thật nằm ở thuộc tính
            `required` của input. */}
        {required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {/*
        LỖI VÀ GỢI Ý KHÔNG LOẠI TRỪ NHAU (12/09).

        Bản cũ dùng `error ? … : hint ? …`, nên đúng lúc ô vừa báo sai thì dòng gợi ý biến
        mất — trong khi gợi ý thường chính là thứ nói cho người dùng biết viết thế nào cho
        đúng ("Tối thiểu 12 ký tự, có ít nhất 3 trong 4 nhóm…"). Giấu nó đi ở đúng khoảnh
        khắc người ta cần là biến một lần gõ sai thành một vòng thử-và-đoán.

        Thứ tự: lỗi TRƯỚC (đỏ, `role="alert"`, trình đọc màn hình đọc ngay), gợi ý ở dưới.
      */}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
      {hint ? <span className="field-hint muted">{hint}</span> : null}
    </div>
  );
}
