import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Hai khuôn đọc của trang chi tiết thiết bị và phần mềm (Q-27, AD-15) — dùng chung để hai trang
 * cùng một kiểu, máy nào / hồ sơ nào cũng một khuôn.
 *
 * Ô CHƯA KHAI ĐỨNG ĐÚNG CHỖ. Ẩn ô trống làm mỗi trang một hình (máy khai đủ 10 dòng, máy sơ sài 3
 * dòng), người đọc không biết "không thấy" là chưa khai hay không có. Q-27 bỏ cách đó: ô vẫn đứng
 * đúng thứ tự, chữ mờ "chưa khai" — và đó cũng là danh sách việc còn thiếu.
 */

export interface Fact {
  key: string;
  label: string;
  /** `null` / `''` = chưa khai → in `blankText`. */
  value: ReactNode;
  /** Dòng nhỏ dưới giá trị (phòng ban, hạn tới ngày…). */
  note?: ReactNode;
  /** Chữ thay cho giá trị khi trống ("chưa cấp IP"); mặc định "chưa khai". */
  blankText?: string;
  /** Nút / việc ngay trong ô (Cấp IP, chép…). */
  action?: ReactNode;
}

const isBlank = (value: ReactNode) => value === null || value === undefined || value === '';

/** Dải 4 ô ngay dưới đầu trang — thấy ở mọi tab, 2 × 2 trên điện thoại. */
export function FactStrip({ facts, label }: { facts: Fact[]; label: string }) {
  const { t } = useTranslation();
  return (
    <dl className="fact-strip" role="group" aria-label={label}>
      {facts.map((fact) => {
        const blank = isBlank(fact.value);
        return (
          <div className="fact" key={fact.key} data-fact={fact.key}>
            <dt>{fact.label}</dt>
            <dd className="fact-v" data-blank={blank ? 'true' : undefined}>
              {blank ? (fact.blankText ?? t('detail.notDeclared')) : fact.value}
            </dd>
            {fact.note ? <dd className="fact-note">{fact.note}</dd> : null}
            {fact.action ? <dd className="fact-action">{fact.action}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

export interface SpecItem {
  label: string;
  value: ReactNode;
  /**
   * Bắt buộc khi `value` là phần tử JSX dựng từ một giá trị có thể rỗng: JSX thì luôn "có", nên
   * nơi gọi phải nói thật giá trị gốc có hay không.
   */
  present?: boolean;
}

/** Thông số thứ tự cố định, hai cột trên máy tính, một cột trên điện thoại. */
export function SpecList({ items, label }: { items: SpecItem[]; label: string }) {
  const { t } = useTranslation();
  return (
    <dl className="spec-list" role="group" aria-label={label}>
      {items.map((item) => {
        const blank = item.present === undefined ? isBlank(item.value) : !item.present;
        return (
          <div className="spec-row" key={item.label}>
            <dt>{item.label}</dt>
            <dd data-blank={blank ? 'true' : undefined}>{blank ? t('detail.notDeclared') : item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
