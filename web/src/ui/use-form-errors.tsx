import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { textLooksLikeSecret } from '@/lib/note-secret';

/**
 * Luật của một form: mỗi khoá là một ô, giá trị là câu lỗi tiếng Việt khi ô đó SAI, còn
 * `false`/`null`/`undefined`/`''` nghĩa là ô đó đang hợp lệ.
 */
export type FormRules<K extends string> = Record<K, string | false | null | undefined>;

/**
 * Luật cho ô chữ bắt buộc có độ dài tối thiểu (lý do ẩn/vô hiệu/gỡ… đều ≥3 ký tự) — thay cho
 * `minLength` của trình duyệt, thứ báo bằng tiếng Anh. Tính trên chữ đã cắt khoảng trắng, đúng
 * như API kiểm.
 */
export function textRule(t: TFunction, value: string, min = 1): string | null {
  const length = value.trim().length;
  if (length === 0) return t('formErrors.required');
  return length < min ? t('formErrors.minLength', { min }) : null;
}

/**
 * Luật cho ô chữ tự do ngoài két (ghi chú, mô tả, lý do): chuỗi trông như mật khẩu hay product
 * key bị chặn — cùng luật server dùng cho `@NoSecretText` (Q-19), báo ngay tại ô thay vì đợi
 * 400. Câu lỗi không nhắc lại đoạn chữ.
 */
export function secretTextRule(t: TFunction, value: string | null | undefined): string | null {
  return textLooksLikeSecret(value) ? t('formErrors.secretText') : null;
}

/** Độ dài tối thiểu của ô "lý do" — cùng ngưỡng API kiểm cho các lý do ẩn/vô hiệu/gỡ. */
export const REASON_MIN = 3;

/**
 * Luật MỘT bản cho ô "lý do" (vô hiệu tài khoản, ngừng dùng tài khoản dịch vụ, xoá dải, gỡ rule
 * NAT, xoá IP nhập nhầm): bắt buộc, tối thiểu `REASON_MIN`, không chứa chuỗi trông như mật khẩu
 * — lý do vào lịch sử dạng rõ và người xin đọc nó trong thư.
 */
export function reasonRule(t: TFunction, value: string): string | null {
  return textRule(t, value, REASON_MIN) ?? secretTextRule(t, value);
}

export interface FormErrors<K extends string> {
  /** Gắn lên `<form>` — hook cần nó để tìm ô lỗi đầu tiên theo đúng thứ tự trên màn. */
  formRef: RefObject<HTMLFormElement | null>;
  /**
   * Gọi đầu `onSubmit`. `true` = hợp lệ, gửi đi được. `false` = đã bật hiện lỗi và sẽ đưa
   * tiêu điểm về ô lỗi đầu tiên.
   */
  check: () => boolean;
  /** Câu lỗi của một ô để truyền vào `Field error` — `null` khi chưa bấm Lưu lần nào. */
  error: (key: K) => string | null;
  /** Dòng tóm tắt đầu form, chỉ có khi từ 2 lỗi trở lên. Đặt ngay dưới khối lỗi của server. */
  summary: ReactNode;
  /** Tắt hiện lỗi — dùng khi form được dựng lại cho một bản ghi khác mà không unmount. */
  reset: () => void;
}

/**
 * Kiểm form lúc bấm Lưu, báo lỗi tiếng Việt DƯỚI TỪNG Ô (AD-15, DoD 6).
 *
 * Form dùng hook này phải đặt `noValidate` lên `<form>`: thuộc tính `required` của ô vẫn giữ
 * để trình đọc màn hình đọc "bắt buộc", nhưng trình duyệt thôi hiện bong bóng tiếng Anh — thứ
 * đi theo ngôn ngữ trình duyệt, mỗi lần chỉ nói một ô, và chặn trước khi câu tiếng Việt kịp chạy.
 *
 * Luật được tính lại MỖI lần render từ state của form, không chụp lại lúc bấm Lưu: nhờ thế lỗi
 * của một ô tự tắt ngay khi người dùng sửa xong ô đó, mà nơi gọi không phải nhớ gọi `clear`
 * ở từng `onChange`.
 *
 * Lỗi chỉ HIỆN sau lần bấm Lưu đầu tiên — mở form ra mà đã đỏ cả loạt là mắng người chưa kịp
 * gõ gì.
 */
export function useFormErrors<K extends string>(rules: FormRules<K>): FormErrors<K> {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [shown, setShown] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  const failing = (Object.keys(rules) as K[]).filter((key) => Boolean(rules[key]));

  /*
   * Tiêu điểm đi SAU lượt render bật lỗi: trước đó ô chưa mang `aria-invalid` và câu lỗi chưa
   * có trong DOM. Tìm theo DOM chứ không theo thứ tự khoá trong `rules`, vì thứ tự trên màn mới
   * là thứ người dùng đọc — khoá khai lệch thứ tự thì tiêu điểm nhảy lung tung.
   */
  useEffect(() => {
    if (focusTick === 0) return;
    const form = formRef.current;
    if (!form) return;
    const firstError = form.querySelector('.field-error');
    const field = firstError?.closest('.field') ?? null;
    const target =
      field?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      field?.querySelector<HTMLElement>('input, select, textarea, button') ??
      form.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.focus();
  }, [focusTick]);

  return {
    formRef,
    check: () => {
      setShown(true);
      if (failing.length === 0) return true;
      setFocusTick((tick) => tick + 1);
      return false;
    },
    error: (key) => (shown ? rules[key] || null : null),
    summary:
      shown && failing.length >= 2 ? (
        <p className="alert error" role="alert">
          {t('formErrors.summary', { count: failing.length })}
        </p>
      ) : null,
    reset: () => setShown(false),
  };
}
