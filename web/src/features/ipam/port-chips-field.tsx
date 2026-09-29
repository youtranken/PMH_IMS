import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIpamSettings } from './ipam-settings';
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
  const { natWidePortRange } = useIpamSettings();
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
        /*
         * `id` đặt lên chính danh sách chip khi ô nhập đã bị tháo (chế độ sửa, danh sách đầy
         * ngay từ đầu). Không có nó thì `<Field htmlFor="nat-external">` trỏ vào một phần tử
         * không tồn tại: bấm nhãn không xảy ra gì, và `getByLabel('Port ngoài')` của bài kiểm
         * cũng không tìm ra gì. Cùng lỗi đã sửa cho ô "IP trong" bằng cách thêm `id` vào
         * `Select`, chỉ khác chỗ.
         */
        <ul className="chip-list" id={full ? inputId : undefined}>
          {chips.map((chip, index) => (
            <li key={chip.value} className={`chip${isWideRange(chip, natWidePortRange) ? ' chip-warn' : ''}`}>
              <span className="mono">{chip.value}</span>
              {/* Lớp `.chip button` của `form-layout.css` lo hình dáng nút ✕ — không dựng
                  bản riêng, chip ở màn khác phải trông y hệt. */}
              <button
                type="button"
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
        <>
          <p className="field-hint muted">{t('nat.portOneOnly')}</p>
          {/*
            Phần CHƯA nhận được vẫn phải NHÌN THẤY, kể cả khi ô nhập đã biến mất.
            Dán "80,443,8080" vào hộp Sửa (`max = 1`): `80` thành chip, danh sách đầy ngay,
            `.chip-add` bị tháo — và `443, 8080` nằm trong `draft` mà không chỗ nào vẽ ra.
            Đúng thứ mà chú thích ở nhánh dưới hứa là không xảy ra.
          */}
          {draft.trim() ? (
            <p className="field-hint muted">
              {t('nat.portLeftover')} <span className="mono">{draft}</span>
            </p>
          ) : null}
        </>
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
              let failure: ChipError | null = null;
              /**
               * Phần CHƯA nhận được — mẩu hỏng và MỌI mẩu đứng sau nó.
               *
               * Chỉ giữ lại đúng mẩu hỏng (`setDraft(stuck || tail)`) thì dán "80, rác, 443"
               * là `80` thành chip, `rác` ở lại kèm lỗi, còn `443` biến mất không dấu vết.
               * Ở chế độ sửa cũng vậy: dán "80,443,8080" thì `8080` bốc hơi.
               */
              const leftover: string[] = [];
              for (const part of parts) {
                // Đã có mẩu kẹt thì mọi mẩu sau nó cũng ở lại NGUYÊN thứ tự — không nhận
                // tiếp, cũng không vứt đi.
                if (leftover.length > 0) {
                  leftover.push(part.trim());
                  continue;
                }
                if (!part.trim()) continue;
                const parsed = parsePortChip(part, next);
                if (!parsed.chip) {
                  failure = parsed.reason;
                  leftover.push(part.trim());
                  continue;
                }
                // Đã đầy (chế độ sửa) thì mẩu này ở lại trong ô chứ không bị nuốt — người
                // dán vào phải thấy phần chưa nhận được, không phải đoán.
                if (next.length >= max) {
                  leftover.push(part.trim());
                  continue;
                }
                next = [...next, parsed.chip];
              }
              if (next !== chips) onChange(next);
              // Bỏ mẩu rỗng trước khi nối, không thì ô còn lại dấu phẩy lơ lửng ở cuối.
              setDraft([...leftover, tail.trim()].filter(Boolean).join(', '));
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
          {/* Nút cỡ thường, cao bằng ô nhập — bản `sm` xám nhạt cạnh ô cao hơn trông như
              đang bị vô hiệu, và người ta gõ xong bấm Lưu luôn. (Rời ô cũng tự chốt chip.) */}
          <button
            type="button"
            className="btn"
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
