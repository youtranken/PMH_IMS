import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AttachmentPanel, ATTACHMENT_ACCEPT } from '@/ui/attachment-panel';
import { useAttachmentDraft, type AttachmentDraft } from '@/ui/attachment-draft';
import { Dialog } from '@/ui/dialog';
import { CloseIcon } from '@/ui/glyph-icons';

/** Một dòng ghế đang khai trong form (Q-27). */
export interface SeatDraftRow {
  seatNo: number;
  contract: string;
  note: string;
}

/**
 * Bảng ghế của hồ sơ bật "mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng" (Q-27): mỗi dòng một
 * ghế, ô số hợp đồng, ô ghi chú, giấy tờ riêng.
 *
 * Giấy tờ: THÊM MỚI chưa có id ghế nên mỗi dòng giữ một bản nháp (`useAttachmentDraft` riêng, báo
 * lên qua `onDraft`), form tải lên sau khi lưu; SỬA thì ghế đã có id — nút mở `AttachmentPanel`
 * của đúng ghế đó (ghi thẳng như mọi panel giấy tờ).
 */
export function SeatEditor({
  rows,
  seatIds,
  csrfToken,
  disabled,
  noteError,
  onChange,
  onDraft,
}: {
  rows: SeatDraftRow[];
  /** id ghế đã lưu theo số ghế — có thì dòng đó mở được giấy tờ thật. */
  seatIds: Map<number, string>;
  csrfToken: string;
  disabled?: boolean;
  noteError: (seatNo: number) => string | undefined;
  onChange: (seatNo: number, patch: Partial<SeatDraftRow>) => void;
  onDraft: (seatNo: number, draft: AttachmentDraft | null) => void;
}) {
  const { t } = useTranslation();
  const [filesOf, setFilesOf] = useState<{ seatNo: number; id: string } | null>(null);
  const first = rows[0];
  return (
    <div className="seat-editor span-3">
      <table className="table table-sub table-cards">
        <thead>
          <tr>
            <th>{t('software.seatCol')}</th>
            <th>{t('software.seatContract')}</th>
            <th>{t('software.seatNote')}</th>
            <th>{t('software.seatFiles')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = seatIds.get(row.seatNo);
            const error = noteError(row.seatNo);
            return (
              <tr key={row.seatNo}>
                <td className="seat-no">{t('software.seatLabel', { n: row.seatNo })}</td>
                <td>
                  <input
                    className="inp mono"
                    aria-label={t('software.seatContractOf', { n: row.seatNo })}
                    maxLength={200}
                    disabled={disabled}
                    value={row.contract}
                    onChange={(e) => onChange(row.seatNo, { contract: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    id={`seat-note-${row.seatNo}`}
                    className="inp"
                    aria-label={t('software.seatNoteOf', { n: row.seatNo })}
                    aria-invalid={error ? true : undefined}
                    maxLength={500}
                    disabled={disabled}
                    value={row.note}
                    onChange={(e) => onChange(row.seatNo, { note: e.target.value })}
                  />
                  {error ? (
                    <span className="field-error" role="alert">
                      {error}
                    </span>
                  ) : null}
                </td>
                <td>
                  {id ? (
                    <button type="button" className="btn sm" onClick={() => setFilesOf({ seatNo: row.seatNo, id })}>
                      {t('software.seatFilesOpen', { n: row.seatNo })}
                    </button>
                  ) : (
                    <SeatFileDraft seatNo={row.seatNo} disabled={disabled} onDraft={onDraft} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 1 && first?.contract.trim() ? (
        <button
          type="button"
          className="btn sm ghost"
          disabled={disabled}
          onClick={() => rows.slice(1).forEach((row) => onChange(row.seatNo, { contract: first.contract }))}
        >
          {t('software.seatCopyContract')}
        </button>
      ) : null}
      {filesOf ? (
        <Dialog open onOpenChange={() => setFilesOf(null)} maxWidth={720} title={t('software.seatFilesTitle', { n: filesOf.seatNo })}>
          <AttachmentPanel ownerType="software_seat" ownerId={filesOf.id} csrfToken={csrfToken} canEdit={!disabled} />
        </Dialog>
      ) : null}
    </div>
  );
}

/** Giấy tờ nháp của MỘT ghế khi thêm mới — tải lên sau khi hồ sơ (và ghế) đã có id. */
function SeatFileDraft({
  seatNo,
  disabled,
  onDraft,
}: {
  seatNo: number;
  disabled?: boolean;
  onDraft: (seatNo: number, draft: AttachmentDraft | null) => void;
}) {
  const { t } = useTranslation();
  const draft = useAttachmentDraft();
  // Báo bản nháp lên form mỗi lượt vẽ (đối tượng `draft` dựng lại mỗi lượt); gỡ khi dòng biến mất.
  useEffect(() => {
    onDraft(seatNo, draft);
  });
  useEffect(() => () => onDraft(seatNo, null), [seatNo]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="seat-files">
      <label className={disabled ? 'btn sm is-disabled' : 'btn sm'}>
        {t('software.seatFilesPick')}
        <input
          key={draft.files.length}
          type="file"
          multiple
          hidden
          accept={ATTACHMENT_ACCEPT}
          aria-label={t('software.seatFilesOf', { n: seatNo })}
          disabled={disabled}
          onChange={(e) => draft.addMany(Array.from(e.target.files ?? []))}
        />
      </label>
      {draft.files.map((file, index) => (
        <span key={`${file.name}-${file.size}`} className="seat-file">
          <span className="mono">{file.name}</span>{' '}
          <button
            type="button"
            className="btn-x danger"
            aria-label={t('attachments.draftRemoveOf', { name: file.name })}
            title={t('attachments.draftRemove')}
            disabled={disabled}
            onClick={() => draft.removeAt(index)}
          >
            <CloseIcon />
          </button>
        </span>
      ))}
      {draft.rejected ? (
        <span className="field-error" role="alert">
          {draft.rejected}
        </span>
      ) : null}
    </div>
  );
}
