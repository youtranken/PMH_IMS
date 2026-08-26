import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isWideRange, parsePortChip, type ChipError, type PortChip } from './port-chips';

/**
 * Ô nhập nhiều khoảng port dạng chip, mỗi chip có ✕ để bỏ ra.
 *
 * Gõ xong bấm Enter (hoặc nút ＋) thì khoảng vừa gõ thành một chip; sai định dạng thì báo
 * NGAY dưới ô, không chờ tới lúc bấm Lưu. Dấu phẩy cũng chốt chip, vì người ta hay chép cả
 * chuỗi "80, 443" từ email của nhà mạng.
 */
export function PortChipsField({
  chips,
  onChange,
  /** Sửa một rule đang có thì chỉ giữ ĐÚNG một khoảng — xem chú thích ở `NatForm`. */
  max = Number.POSITIVE_INFINITY,
  disabled,
  inputId,
}: {
  chips: PortChip[];
  onChange: (next: PortChip[]) => void;
  max?: number;
  disabled?: boolean;
  inputId: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<ChipError | null>(null);
  const full = chips.length >= max;

  const commit = () => {
    if (!draft.trim()) return;
    const parsed = parsePortChip(draft, chips);
    if (!parsed.chip) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    setDraft('');
    onChange([...chips, parsed.chip]);
  };

  return (
    <div className="port-chips">
      {chips.length > 0 ? (
        <ul className="chip-list">
          {chips.map((chip, index) => (
            <li key={chip.value} className={`chip${isWideRange(chip) ? ' chip-warn' : ''}`}>
              <span className="mono">{chip.value}</span>
              <button
                type="button"
                className="chip-x"
                disabled={disabled}
                aria-label={t('nat.portRemove', { port: chip.value })}
                onClick={() => onChange(chips.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? (
        <p className="field-hint muted">{t('nat.portOneOnly')}</p>
      ) : (
        <div className="chip-add">
          <input
            id={inputId}
            className="inp mono"
            placeholder={t('nat.portPlaceholder')}
            disabled={disabled}
            value={draft}
            onChange={(e) => {
              const raw = e.target.value;
              if (!raw.includes(',')) {
                setDraft(raw);
                setError(null);
                return;
              }
              /* Dấu phẩy = chốt chip. Chép nguyên "80, 443, 8000-8010" từ email nhà mạng vào
                 là ra ba chip, chứ không phải một chuỗi hỏng mà tới lúc bấm Lưu mới biết.
                 Mẩu cuối (sau dấu phẩy cuối cùng) ở lại trong ô vì người ta còn đang gõ dở;
                 mẩu nào sai thì ở lại luôn kèm lỗi, không bị nuốt mất. */
              const parts = raw.split(',');
              const tail = parts.pop() ?? '';
              let next = chips;
              let stuck = '';
              let failure: ChipError | null = null;
              for (const part of parts) {
                if (!part.trim()) continue;
                const parsed = parsePortChip(part, next);
                if (!parsed.chip) {
                  stuck = part.trim();
                  failure = parsed.reason;
                  break;
                }
                // Đã đầy (chế độ sửa) thì mẩu này ở lại trong ô chứ không bị nuốt — người
                // dán vào phải thấy phần chưa nhận được, không phải đoán.
                if (next.length >= max) {
                  stuck = part.trim();
                  break;
                }
                next = [...next, parsed.chip];
              }
              if (next !== chips) onChange(next);
              setDraft(stuck || tail);
              setError(failure);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // Enter trong ô này là "thêm chip", KHÔNG phải "gửi form" — không chặn thì
              // gõ port đầu tiên rồi Enter là form bay đi với danh sách port rỗng.
              e.preventDefault();
              commit();
            }}
            onBlur={commit}
          />
          <button
            type="button"
            className="btn sm"
            disabled={disabled || !draft.trim()}
            onClick={commit}
          >
            {t('nat.portAdd')}
          </button>
        </div>
      )}

      {error ? (
        <span className="field-error" role="alert">
          {t(`nat.portErr_${error}`)}
        </span>
      ) : null}
    </div>
  );
}
