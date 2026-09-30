import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage, useApiMutation } from '@/lib/api';
import type { DeviceRow } from '@/lib/device-types';
import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input';
import { Combobox } from '@/ui/combobox';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { MoneyInput } from '@/ui/money-input';
import { Field } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { SuggestInput } from '@/ui/suggest-input';
import { useDepartments } from '@/ui/use-departments';
import { useFormErrors } from '@/ui/use-form-errors';
import { seatLabel, type LicenseSeat, type SoftwareRow } from './software-types';

/** Trần của một lượt chọn nhanh — đúng trần `limit` của API danh sách thiết bị. */
const QUICK_PICK_LIMIT = 200;

/**
 * Hộp gán license vào máy — VÀ hộp sửa kỳ hạn/chi phí của một ghế đã gán.
 *
 * Một hộp cho cả hai vì các ô là MỘT BỘ: chi phí, hợp đồng, kỳ hạn riêng, ghi chú. Tách hai
 * hộp thì lần sau thêm một ô sẽ chỉ nhớ thêm vào một bên — và bên còn lại âm thầm ghi thiếu.
 * Khác nhau đúng hai chỗ: có chọn máy hay không, và POST hay PATCH.
 *
 * Danh sách (menu dòng), khu bung dòng và tab Máy đang dùng đều mở ĐÚNG hộp này (AD-15): hai
 * bản sẽ trôi khác nhau đúng lúc luật vượt số ghế đổi.
 */
export function AssignDialog({
  software,
  seat,
  csrfToken,
  onClose,
  onDone,
}: {
  software: SoftwareRow;
  /** Có giá trị = SỬA ghế đang có (khóa máy, PATCH). Bỏ trống = gán máy mới. */
  seat?: LicenseSeat;
  csrfToken: string;
  onClose: () => void;
  /** `count` = số máy vừa gán (gán nhiều máy một lượt — SW-053); sửa ghế thì 1. */
  onDone: (warnings: string[], count: number) => void;
}) {
  const { t } = useTranslation();
  const editing = seat !== undefined;
  /* Client đã biết license hết ghế thì nói ngay khi mở hộp, đừng để người dùng bấm Gán một lần
     cho server từ chối rồi ô lý do mới mọc ra (AC 3.2 vẫn cho gán vượt khi có lý do). */
  const full =
    !editing && software.seatTotal !== null && software.seatUsed >= software.seatTotal;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  /* NHIỀU máy một lượt (SW-053): mua 10 ghế cho phòng Kế toán không phải mở hộp 10 lần và gõ
     lại 10 lần cùng chi phí/hợp đồng/kỳ hạn. Điều khoản ghế dùng chung cho cả lô. */
  const [devices, setDevices] = useState<{ id: string; code: string }[]>([]);
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState(seat?.note ?? '');
  // Chi phí giữ dạng CHUỖI trong lúc gõ: ô rỗng phải khác được với số 0.
  const [cost, setCost] = useState(formatMoneyInput(seat?.cost ?? null));
  const [contract, setContract] = useState(seat?.contract ?? '');
  const [startDate, setStartDate] = useState(seat?.startDate ?? '');
  const [endDate, setEndDate] = useState(seat?.endDate ?? '');
  const [overSeatReason, setOverSeatReason] = useState('');
  const [reasonAsked, setNeedReason] = useState(full);
  /* Lô vượt số ghế còn lại thì hỏi lý do NGAY, đừng để lượt thứ k bị server từ chối giữa chừng. */
  const needReason =
    reasonAsked ||
    (!editing &&
      software.seatTotal !== null &&
      software.seatUsed + devices.length > software.seatTotal);
  const [error, setError] = useState<string | null>(null);
  /* Ba cách chọn máy, mỗi lúc chỉ bày MỘT ô: tìm từng máy, hoặc cả lô theo phòng ban / người
     sử dụng (mua 10 ghế cho phòng Kế toán thì chọn "Kế toán" một lần, rồi bỏ bớt máy không
     cần). Kết quả luôn là chip MÁY: ghế license gắn vào máy (device_id NOT NULL), phòng ban
     hay người chỉ là lối tắt để chọn máy. */
  const [pickBy, setPickBy] = useState<'device' | 'department' | 'assignedTo'>('device');
  const [quickValue, setQuickValue] = useState('');
  const [quickNote, setQuickNote] = useState<string | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const departments = useDepartments();
  const [personDebounced, setPersonDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setPersonDebounced(quickValue.trim()), 250);
    return () => clearTimeout(id);
  }, [quickValue]);
  /* Không có danh mục người sử dụng: gợi ý lấy từ chính các máy đang dùng khớp chữ đang gõ,
     để tên chọn ra là tên có máy thật — phép lọc `assignedTo` phía API khớp ĐÚNG, không "chứa". */
  const people = useQuery({
    queryKey: ['devices', 'assignees', personDebounced],
    enabled: !editing && pickBy === 'assignedTo' && personDebounced.length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=50&usable=true&status=in_use&search=${encodeURIComponent(personDebounced)}`,
      ),
  });
  const personOptions = [
    ...new Set(
      (people.data?.items ?? [])
        .map((item) => item.assignedTo?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  async function quickAdd() {
    const who = quickValue.trim();
    if (!who) {
      setQuickNote(t('license.quickPickNeedValue'));
      return;
    }
    setQuickLoading(true);
    setQuickNote(null);
    try {
      /* Chỉ máy ĐANG DÙNG (không lấy máy dự phòng/hỏng nằm kho của phòng), và bỏ máy đã có
         license này — gán lại máy đó thì API từ chối và cả lô dừng giữa chừng. */
      const [found, seats] = await Promise.all([
        apiFetch<{ items: DeviceRow[]; total: number }>(
          `/api/v1/devices?limit=${QUICK_PICK_LIMIT}&usable=true&status=in_use&${pickBy}=${encodeURIComponent(who)}`,
        ),
        apiFetch<LicenseSeat[]>(`/api/v1/software/${software.id}/assignments`),
      ]);
      const holding = new Set(seats.map((item) => item.deviceId));
      const fresh = found.items.filter(
        (item) => !holding.has(item.id) && !devices.some((picked) => picked.id === item.id),
      );
      const held = found.items.filter((item) => holding.has(item.id)).length;
      setDevices((current) => [...current, ...fresh.map((item) => ({ id: item.id, code: item.code }))]);
      const notes: string[] = [];
      if (found.items.length === 0) notes.push(t('license.quickPickNone', { who }));
      else if (fresh.length === 0 && held === found.items.length) {
        notes.push(t('license.quickPickAllHeld', { who }));
      } else {
        notes.push(t('license.quickPickAdded', { count: fresh.length, who }));
        if (held > 0) notes.push(t('license.quickPickHeld', { count: held }));
      }
      if (found.total > found.items.length) {
        notes.push(t('license.quickPickTruncated', { count: found.items.length }));
      }
      setQuickNote(notes.join(' '));
    } catch (err) {
      setQuickNote(errorMessage(err));
    } finally {
      setQuickLoading(false);
    }
  }

  // License mua đứt thì chỗ ngồi của nó cũng không có ngày kết thúc — ô đó không được hiện
  // ra để rồi API trả về lỗi. Luật nằm ở API (`validateAssignmentTerms`), đây chỉ là hệ quả.
  const hasEndDate = software.licenseModel !== 'perpetual';
  const money = parseMoneyInput(cost);
  const check = useFormErrors({
    device: !editing && devices.length === 0 && t('license.pickDevice'),
    cost: money.reason === 'invalid' && t('license.costInvalid'),
    overSeatReason: needReason && !overSeatReason.trim() && t('license.overSeatRequired'),
  });

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced],
    enabled: !editing && pickBy === 'device' && debounced.trim().length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&usable=true&search=${encodeURIComponent(debounced.trim())}`,
      ),
  });

  const save = useApiMutation<Record<string, unknown>, { warnings?: string[] }>(
    editing
      ? `/api/v1/software/${software.id}/assignments/${seat.id}`
      : `/api/v1/software/${software.id}/assignments`,
    { method: editing ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending && !running}
      maxWidth={640}
      title={
        editing
          ? `${t('license.editSeatTitle')} — ${seat.deviceCode}`
          : `${t('license.assignTitle')} — ${software.code}`
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="assign-form"
            className="btn primary"
            disabled={save.isPending || running}
          >
            {save.isPending || running
              ? t('common.loading')
              : editing
                ? t('common.save')
                : needReason
                  ? t('license.assignOver')
                  : devices.length > 1
                    ? t('license.assignMany', { count: devices.length })
                    : t('license.assign')}
          </button>
        </>
      }
    >
      {/* `.form-grid` tự chia cột theo bề rộng (auto-fill 210px): ở hộp 640px là 2 cột. */}
      <form
        id="assign-form"
        className="form-grid"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          const terms = {
            cost: money.value,
            contract: contract.trim(),
            startDate,
            endDate: hasEndDate ? endDate : '',
            note: note.trim(),
          };
          if (editing) {
            save.mutate(terms, {
              onSuccess: (result) => onDone(result.warnings ?? [], 1),
              onError: (err) => setError(errorMessage(err)),
            });
            return;
          }
          /*
           * Từng máy một, TUẦN TỰ: mỗi lượt gán là một transaction + một dòng audit của chính
           * nó ở API, và luật vượt ghế xét trên hàng đã khoá — gửi song song thì N lượt cùng
           * đọc "còn ghế" một lúc. Hỏng giữa chừng thì DỪNG, bỏ khỏi danh sách những máy đã
           * gán xong, nói rõ máy nào hỏng: bấm lại là gán tiếp phần còn lại, không gán trùng.
           */
          void (async () => {
            setRunning(true);
            const warnings: string[] = [];
            const doneIds: string[] = [];
            for (const target of devices) {
              try {
                const result = await save.mutateAsync({
                  deviceId: target.id,
                  overSeatReason: overSeatReason.trim(),
                  ...terms,
                });
                warnings.push(...(result.warnings ?? []));
                doneIds.push(target.id);
              } catch (err) {
                // Hết ghế mà client chưa biết (người khác vừa gán): mở ô lý do rồi cho gửi lại.
                if (errorCode(err) === 'SEAT_LIMIT_REACHED') setNeedReason(true);
                setDevices((current) => current.filter((item) => !doneIds.includes(item.id)));
                setError(
                  doneIds.length > 0
                    ? t('license.assignPartial', {
                        done: doneIds.length,
                        code: target.code,
                        reason: errorMessage(err),
                      })
                    : errorMessage(err),
                );
                if (doneIds.length > 0) {
                  void queryClient.invalidateQueries({ queryKey: ['software'] });
                }
                setRunning(false);
                return;
              }
            }
            setRunning(false);
            onDone(warnings, doneIds.length);
          })();
        }}
      >
        {full ? (
          <p className="alert warn span-2" role="status">
            {t('license.fullWarning', { seats: seatLabel(software) })}
          </p>
        ) : (
          <p className="muted span-2">
            {t('software.seats')}: <span className="mono">{seatLabel(software)}</span>
          </p>
        )}
        {!editing && software.status === 'expired_ok' ? (
          <p className="alert warn span-2" role="status">
            {t('license.expiredWarning')}
          </p>
        ) : null}

        {editing ? (
          <Field label={t('license.device')} span={2}>
            {/* Đổi máy KHÔNG phải là sửa ghế: bản ghi cũ phải được gỡ (giữ lại dấu vết) rồi
                gán bản mới, nếu không thì lịch sử "key này từng nhập máy nào" mất một chặng. */}
            <p className="static-value">
              <span className="mono">{seat.deviceCode}</span> {seat.deviceName}
            </p>
          </Field>
        ) : (
          <>
            <div className="span-2">
              <SegmentedRadio
                label={t('license.quickPickBy')}
                value={pickBy}
                options={[
                  { value: 'device', label: t('license.device') },
                  { value: 'department', label: t('license.quickPickDepartment') },
                  { value: 'assignedTo', label: t('license.quickPickPerson') },
                ]}
                onChange={(by) => {
                  if (by === pickBy) return;
                  setPickBy(by);
                  setQuery('');
                  setQuickValue('');
                  setQuickNote(null);
                }}
              />
            </div>
            {pickBy === 'device' ? (
              <Field
                label={t('license.device')}
                required
                hint={t('license.deviceHint')}
                span={2}
                error={check.error('device')}
              >
                <Combobox
                  placeholder={t('license.deviceSearch')}
                  query={query}
                  onQuery={setQuery}
                  // Máy đã nằm trong lô thì không mời chọn lần nữa.
                  options={(candidates.data?.items ?? []).filter(
                    (item) => !devices.some((picked) => picked.id === item.id),
                  )}
                  failed={candidates.isError}
                  getKey={(item) => item.id}
                  renderOption={(item) => (
                    <>
                      <span className="mono">{item.code}</span> <small>{item.name}</small>
                    </>
                  )}
                  onSelect={(item) => {
                    setDevices((current) => [...current, { id: item.id, code: item.code }]);
                    // Xoá ô để gõ tìm máy kế tiếp — chọn xong một máy là chip nằm bên dưới.
                    setQuery('');
                  }}
                />
              </Field>
            ) : (
              <Field
                label={t(
                  pickBy === 'department'
                    ? 'license.quickPickDepartmentLabel'
                    : 'license.quickPickPersonLabel',
                )}
                required
                tip={t('license.quickPickHint')}
                span={2}
                error={check.error('device')}
              >
                <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <SuggestInput
                      value={quickValue}
                      onChange={setQuickValue}
                      options={pickBy === 'department' ? departments.names : personOptions}
                      failed={pickBy === 'department' ? departments.failed : people.isError}
                      placeholder={t(
                        pickBy === 'department'
                          ? 'license.quickPickDepartmentLabel'
                          : 'license.quickPickPersonLabel',
                      )}
                      ariaLabel={t(
                        pickBy === 'department'
                          ? 'license.quickPickDepartmentLabel'
                          : 'license.quickPickPersonLabel',
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={quickLoading || running}
                    onClick={() => void quickAdd()}
                  >
                    {quickLoading ? t('common.loading') : t('license.quickPickAdd')}
                  </button>
                </div>
              </Field>
            )}
            {quickNote ? (
              <p className="muted span-2" role="status">
                {quickNote}
              </p>
            ) : null}
          </>
        )}
        {!editing && devices.length > 0 ? (
          <div className="chip-row span-2" role="list" aria-label={t('license.pickedDevices')}>
            {devices.map((item) => (
              <span key={item.id} className="chip" role="listitem">
                <span className="mono">{item.code}</span>
                <button
                  type="button"
                  aria-label={t('license.unpickDevice', { code: item.code })}
                  disabled={running}
                  onClick={() =>
                    setDevices((current) => current.filter((picked) => picked.id !== item.id))
                  }
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {needReason ? (
          <Field
            label={t('license.overSeatReason')}
            required
            hint={t('license.overSeatHint')}
            htmlFor="assign-reason"
            span={2}
            error={check.error('overSeatReason')}
          >
            <input
              id="assign-reason"
              className="inp"
              value={overSeatReason}
              onChange={(e) => setOverSeatReason(e.target.value)}
            />
          </Field>
        ) : null}

        <Field
          label={t('license.cost')}
          hint={t('license.costHint')}
          htmlFor="assign-cost"
          error={check.error('cost')}
        >
          <MoneyInput value={cost} onChange={setCost} />
        </Field>
        <Field label={t('license.contract')} hint={t('license.contractHint')} htmlFor="assign-contract">
          <input
            id="assign-contract"
            className="inp"
            value={contract}
            onChange={(e) => setContract(e.target.value)}
          />
        </Field>

        <Field label={t('license.startDate')}>
          <DatePicker
            value={startDate}
            ariaLabel={t('license.startDate')}
            onChange={setStartDate}
          />
        </Field>
        {hasEndDate ? (
          <Field label={t('license.endDate')} hint={t('license.endDateHint')}>
            <DatePicker value={endDate} ariaLabel={t('license.endDate')} onChange={setEndDate} />
          </Field>
        ) : (
          <Field label={t('license.endDate')}>
            <p className="static-value">{t('software.perpetual')}</p>
          </Field>
        )}

        <Field label={t('license.note')} htmlFor="assign-note" span={2}>
          <input
            id="assign-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {/* Chỉ lỗi từ SERVER ở đây; lỗi từng ô hiện ngay dưới ô đó (`useFormErrors`). */}
        {error ? (
          <p className="alert error span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
