import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { InfoTip } from '@/ui/info-tip';

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
  /** Thường là chữ; nhận phần tử khi cần `<time title>` (giờ tuyệt đối khi rê chuột). */
  subtitle?: ReactNode;
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
  titleTip,
  children,
  columns = 3,
}: {
  /**
   * Tiêu đề khu. BỎ TRỐNG khi khu chỉ có một ô mà nhãn ô đã nói đúng điều đó — form tài khoản
   * dịch vụ mà để cả hai thì in "Ghi chú" hai lần chồng nhau, cách nhau 8px, vì tiêu đề khu và
   * nhãn ô là cùng một chữ.
   *
   * Không bỏ trống chỉ để cho gọn: khu có từ hai ô trở lên thì tiêu đề là thứ nói cho người
   * đọc biết mấy ô ấy thuộc về nhau.
   */
  title?: string;
  /** Câu giải thích ngắn sau nút (i) cạnh tiêu đề. Cần `title` — nút mang tên theo tiêu đề. */
  titleTip?: ReactNode;
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
}) {
  const heading = title ? <h2 className="form-section-title">{title}</h2> : null;
  return (
    <section className="form-section">
      {/* Nút (i) đứng NGOÀI `<h2>`: đặt trong thì tên của tiêu đề thành "Bảo hành Giải thích: …". */}
      {heading && titleTip ? (
        <div className="form-section-head">
          {heading}
          <InfoTip subject={title as string}>{titleTip}</InfoTip>
        </div>
      ) : (
        heading
      )}
      <div className="form-grid" data-columns={columns}>
        {children}
      </div>
    </section>
  );
}

/**
 * Đứa con của `Field` có phải thứ ĐEO ĐƯỢC `id` của nhãn hay không.
 *
 * ===== VÌ SAO KHÔNG GẮN `id` VÀO BẤT KỲ PHẦN TỬ CON NÀO =====
 *
 * Ở `catalog-form.tsx` con của `Field` là một
 * `<label className="row">` BỌC NGOÀI cái checkbox thật, và checkbox ấy đã tự khai
 * `id="catalog-portmap"` — đúng cái id mà `Field` đang dùng. Gắn bừa thì HAI phần tử mang cùng một
 * `id`, `htmlFor` phân giải vào phần tử ĐẦU TIÊN (cái `<label>` bọc, không phải điều khiển),
 * nên nhãn của `Field` thôi nối vào checkbox và tên trợ năng của nó rơi về câu gợi ý dài bên
 * trong. Tên đổi từ "Có port map" thành "Loại này sẽ hiện bảng port map ở trang chi tiết…".
 *
 * Bài đơn vị không dựng hình dạng "Field bọc một label bọc một input" thì xanh; bài E2E
 * `di-khap-giao-dien` — vốn đếm TÊN TRỢ NĂNG của từng điều khiển trong hộp — là thứ bắt được.
 * Gắn nhầm chỗ không phải "lặng lẽ không làm gì" — nó làm SAI.
 *
 * ===== LUẬT =====
 *
 * · thẻ HTML trần: chỉ gắn cho phần tử NHÃN NỐI ĐƯỢC (`<label for>` hợp lệ với chúng);
 * · component (hàm): gắn — `Select` và `Combobox` đều nhận `id` rồi chuyển xuống phần tử thật,
 *   và `field-a11y.test.tsx` dựng thật cả hai để chắc chuyện đó;
 * · còn lại (`<div>`, `<label>`, mảnh ghép, chuỗi): KHÔNG gắn, để nơi gọi tự lo như trước.
 */
const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);

function canTakeId(children: ReactNode): children is ReactElement<Record<string, unknown>> {
  if (!isValidElement(children)) return false;
  const type = (children as ReactElement).type;
  return typeof type === 'string' ? LABELABLE.has(type) : true;
}

/** Một ô nhập có nhãn — gói lại để nhãn/khoảng cách/aria nhất quán toàn app. */
export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  span,
  tip,
  children,
}: {
  label: string;
  /**
   * Ô bắt buộc — vẽ dấu `*` và, với `Select`/`Combobox`, kéo theo `aria-required`/`required`.
   *
   * ===== DẤU `*` CHỈ CÓ NGHĨA KHI NÓ PHÂN BIỆT ĐƯỢC CÁI GÌ =====
   *
   * Bốn màn `auth/` KHÔNG có dấu nào, và đó là cố ý. (Thêm dấu ở đó còn làm
   * `getByLabel('Mật khẩu', { exact: true })` trong `helpers.ts` không khớp nữa — Playwright
   * khớp theo TEXT của thẻ nhãn, kể cả phần `aria-hidden` — nên MỌI bài E2E đỏ.)
   *
   * Nhưng lý do bỏ dấu không phải vì bài kiểm đỏ. Màn đăng nhập có hai ô, cả hai bắt buộc;
   * màn đổi mật khẩu có ba ô, cả ba bắt buộc. Đánh dấu MỌI ô là nói không được điều gì —
   * giá trị của dấu `*` đến từ việc nó tách ô bắt buộc khỏi ô không bắt buộc. Form nghiệp vụ
   * thì có trộn thật (Mã* Tên* Loại* cạnh Model, Serial, Ghi chú), và đó là chỗ nó đáng có.
   *
   * Cùng lý do đã bỏ dấu ở hai màn dùng `OtpInput`: một ô duy nhất, bắt buộc hiển nhiên.
   */
  required?: boolean;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  span?: 2 | 3;
  /** Câu giải thích ngắn sau nút (i) cạnh nhãn — cho điều `hint` một dòng không nói hết. */
  tip?: ReactNode;
  children: ReactNode;
}) {
  /*
   * ===== `Field` TỰ NỐI NHÃN, GỢI Ý VÀ LỖI VÀO Ô NHẬP =====
   *
   * Để `htmlFor` là việc của NƠI GỌI thì hơn một phần ba chỗ gọi không truyền — nhãn không
   * nối được vào ô, bấm vào nhãn không xảy ra gì, và `getByLabel` của bài kiểm không tìm ra.
   * Vài chỗ thì ô con cũng không có tên trợ năng nào, tức hoàn toàn câm.
   *
   * Và thiếu `aria-describedby` thì `hint`/`error` chỉ là chữ nằm
   * cạnh ô, trình đọc màn hình không biết chúng thuộc về ô nào — người dùng nghe "Mật khẩu,
   * ô nhập" rồi tự đoán, trong khi dòng gợi ý ngay dưới đang nói "tối thiểu 12 ký tự".
   *
   * Bắt từng nơi gọi tự truyền thì nơi gọi mới sẽ quên, và quên thì
   * KHÔNG gì đỏ — form vẫn dựng ra bình thường. Nên `Field` tự làm: nó sinh một `id` khi nơi
   * gọi không cho, rồi GẮN id ấy cùng `aria-describedby` vào chính đứa con của nó.
   *
   * Không đè lên thứ nơi gọi đã tự khai: một ô đã có `id` riêng (để `Select` và `<input>` thay
   * nhau ở cùng một chỗ, hoặc để bài kiểm bám vào) thì giữ nguyên id ấy.
   *
   * Đứa con không nhận `id`/`aria-describedby` thì phép gắn này không có tác dụng — đó là
   * lý do `page-header.test.tsx` dựng thật từng loại điều khiển trong `Field` rồi ĐO lại, thay
   * vì tin rằng đã gắn.
   */
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const control = canTakeId(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? id,
        'aria-describedby':
          (children.props as { 'aria-describedby'?: string })['aria-describedby'] ?? describedBy,
        // Viền đỏ (`shared-kit.css`) và tiêu điểm của `useFormErrors` đều bám vào thuộc tính
        // này, và trình đọc màn hình đọc "không hợp lệ" nhờ nó.
        'aria-invalid':
          (children.props as { 'aria-invalid'?: boolean })['aria-invalid'] ??
          (error ? true : undefined),
      })
    : children;

  const labelEl = (
    <label className="lbl-t" htmlFor={id}>
      {label}{' '}
      {/* Dấu * chỉ là chỉ dấu thị giác: aria-hidden để tên gọi trợ năng của ô nhập là
          đúng nhãn ("Email"), không thành "Email *". Chặn thật nằm ở `useFormErrors` của
          form (form đặt `noValidate`); `required` trên ô để trình đọc màn hình đọc "bắt buộc". */}
      {/*
        `field-req`, KHÔNG phải `req`.

        `form-layout.css` khai `.field-req { color: var(--danger) }`; `className="req"` là một
        lớp không tồn tại. Viết sai thì dấu `*` vẫn hiện, chỉ là cùng màu với nhãn: đúng cái
        bẫy `CLAUDE.md` cảnh báo cho `.dark` — một khối CSS hợp lệ mà không
        bao giờ chạy, và không có gì đỏ vì trang vẫn dựng ra bình thường.
      */}
      {required ? (
        <span className="field-req" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );

  return (
    <div className={`field${span ? ` span-${span}` : ''}`}>
      {/* Nút (i) đứng NGOÀI `<label>`: nằm trong thì tên của nút lọt vào tên trợ năng của ô
          ("Serial Giải thích: Serial"), `getByLabel('Serial', { exact: true })` hết khớp. */}
      {tip ? (
        <div className="field-label-row">
          {labelEl}
          <InfoTip subject={label}>{tip}</InfoTip>
        </div>
      ) : (
        labelEl
      )}
      {control}
      {/*
        LỖI VÀ GỢI Ý KHÔNG LOẠI TRỪ NHAU.

        Viết `error ? … : hint ? …` thì đúng lúc ô vừa báo sai, dòng gợi ý biến
        mất — trong khi gợi ý thường chính là thứ nói cho người dùng biết viết thế nào cho
        đúng ("Tối thiểu 12 ký tự, có ít nhất 3 trong 4 nhóm…"). Giấu nó đi ở đúng khoảnh
        khắc người ta cần là biến một lần gõ sai thành một vòng thử-và-đoán.

        Thứ tự: lỗi TRƯỚC (đỏ, `role="alert"`, trình đọc màn hình đọc ngay), gợi ý ở dưới.
      */}
      {error ? (
        <span className="field-error" role="alert" id={errorId}>
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="field-hint muted" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
