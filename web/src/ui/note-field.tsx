import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from './page-header';

/**
 * Ô "Ghi chú" của mọi form hồ sơ (FM-18). Ghi chú lưu chữ thường, không mã hóa, nên câu cảnh báo
 * mật khẩu phải giống nhau ở mọi nơi — sáu câu khác nhau thì người ta đọc thành sáu luật. Nơi gọi
 * vẫn tự gắn `secretTextRule` vào `error`: luật nằm ở form, ô chỉ hiện.
 */
export function NoteField({
  id,
  value,
  onChange,
  label,
  error,
  span,
  tip,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Mặc định "Ghi chú". */
  label?: string;
  error?: string | null;
  span?: 2 | 3;
  /** Gợi ý nên ghi gì (vd số phiếu yêu cầu) — vào nút (i), câu cảnh báo vẫn ở dưới ô. */
  tip?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label ?? t('common.note')} hint={t('common.noteHint')} htmlFor={id} span={span} tip={tip} error={error}>
      <textarea id={id} className="inp" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
