import { todayIso } from '@/lib/format';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { NoteField } from '@/ui/note-field';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { NumberStepper } from '@/ui/number-stepper';
import { AttachmentDraftSection, useAttachmentDraft, type AttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Select } from '@/ui/select';
import { SubmitButton } from '@/ui/submit-button';
import { useToast } from '@/ui/toast';
import { YearQuickPicks } from '@/ui/year-quick-picks';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { secretTextRule, useFormErrors, useSubmitError } from '@/ui/use-form-errors';
import {
  codePrefix,
  KIND_KEY,
  LICENSE_MODELS,
  nextBatchCode,
  requiresEndDate,
  seatCheck,
  SOFTWARE_STATUSES,
  STATUS_KEY,
  supportsSeats,
  supportsWebsites,
  websiteLines,
  type LicenseModel,
  type SoftwareDetailRow,
  type SoftwareKind,
  type SoftwareRow,
  type SoftwareStatus,
} from './software-types';
import { SeatEditor, type SeatDraftRow } from './seat-editor';
import {
  SOFTWARE_SCREENS,
  screenOfKind,
  type SoftwareScreenKey,
} from '@/lib/software-screens';
import { CodeInput } from '@/ui/code-input';
import { useServerFieldErrors } from '@/ui/use-server-field-errors';

interface FormState {
  code: string;
  name: string;
  kind: SoftwareKind;
  licenseModel: LicenseModel;
  vendorId: string;
  seatTotal: string;
  startDate: string;
  endDate: string;
  note: string;
  status: SoftwareStatus;
  /** Mỗi dòng một tên miền — chỉ SSL / tên miền (Q-22). */
  websites: string;
  /** Số hợp đồng / PO chung của mọi ghế (Q-27). */
  contract: string;
  /** Mỗi ghế có hợp đồng, ghi chú, giấy tờ riêng (Q-27). */
  perSeat: boolean;
}

function initialState(row: SoftwareRow | null, firstKind: SoftwareKind, batchFrom: SoftwareRow | null): FormState {
  // Đợt mua mới (Q-27): cùng phần mềm, cùng nhà cung cấp, cùng kỳ hạn — khác mã, ngày, ghế, hợp đồng.
  if (!row && batchFrom) {
    return {
      ...initialState(null, firstKind, null),
      name: batchFrom.name,
      kind: batchFrom.kind,
      licenseModel: batchFrom.licenseModel,
      vendorId: batchFrom.vendorId ?? '',
    };
  }
  return {
    code: row?.code ?? '',
    name: row?.name ?? '',
    kind: row?.kind ?? firstKind,
    licenseModel: row?.licenseModel ?? 'subscription',
    vendorId: row?.vendorId ?? '',
    seatTotal: row?.seatTotal != null ? String(row.seatTotal) : '',
    // Hồ sơ mới: hôm nay (FM-06) — ô trống thì các nút +1 / +2 / +3 năm không có mốc để cộng.
    startDate: row ? (row.startDate ?? '') : todayIso(),
    endDate: row?.endDate ?? '',
    note: row?.note ?? '',
    status: row?.status ?? 'active',
    websites: (row?.websites ?? []).join('\n'),
    contract: row?.contract ?? '',
    perSeat: row?.perSeat ?? false,
  };
}

/**
 * Form hồ sơ phần mềm (FR-008). Màn nhập — desktop-first.
 *
 * `screen` quyết những loại được chọn (Q-22): màn Tên miền & SSL chọn giữa hai loại của nó, các
 * màn còn lại cố định loại nên không bày ô Loại. Vắng `screen` thì lấy màn của hồ sơ đang sửa.
 *
 * Bố cục Q-27: Phần mềm gì (tên · mã · nhà cung cấp) → Thời hạn (kỳ hạn · bắt đầu · hết hạn) →
 * Ghế và hợp đồng (license) → Ghi chú và giấy tờ. License bật "mỗi ghế riêng" thì hợp đồng,
 * ghi chú, giấy tờ khai theo từng ghế, khối chung ẩn đi.
 */
export function SoftwareForm({
  row,
  screen,
  batchFrom = null,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  row: SoftwareRow | null;
  screen?: SoftwareScreenKey;
  /** "Mua thêm đợt mới" (Q-27): hồ sơ mới điền sẵn theo đợt này, gợi ý mã kế tiếp. */
  batchFrom?: SoftwareRow | null;
  csrfToken: string;
  onClose: () => void;
  /** `assign`: người dùng bấm "Lưu rồi gán vào máy" — nơi gọi mở hộp Gán của hồ sơ `id`. */
  onSaved: (result?: { id: string; assign: boolean }) => void;
}) {
  const { t } = useTranslation();
  const spec = screen ? SOFTWARE_SCREENS[screen] : row ? screenOfKind(row.kind) : batchFrom ? screenOfKind(batchFrom.kind) : SOFTWARE_SCREENS.software;
  /* Hồ sơ đang sửa mà loại không thuộc màn (dữ liệu cũ) vẫn giữ được loại của nó — ép đổi loại
     chỉ vì mở form từ màn khác là đổi dữ liệu ngoài ý người sửa. */
  const kinds: readonly SoftwareKind[] =
    row && !spec.kinds.includes(row.kind) ? [row.kind, ...spec.kinds] : spec.kinds;
  const toast = useToast();
  /*
   * Form TỰ hỏi danh mục thay vì nhận qua props: `useCatalogLists` dùng chung `queryKey` nên
   * đây không phải lượt gọi thêm, nhưng form THẤY được `isError`. Props `CatalogLists |
   * undefined` không có đường nào phân biệt "danh mục hỏng" với "chưa tải xong".
   */
  const lists = useCatalogLists();
  const [form, setForm] = useState<FormState>(() => initialState(row, kinds[0], batchFrom));
  const [error, setError] = useSubmitError([form]);
  const server = useServerFieldErrors([form]);
  // Giấy tờ chọn kèm lúc THÊM MỚI (AD-15). Hồ sơ đang sửa thì đã có tab Giấy tờ ở trang
  // chi tiết — bày thêm một ô chọn ở đây chỉ làm người ta tưởng danh sách cũ biến mất.
  const draft = useAttachmentDraft();
  const [uploading, setUploading] = useState(false);
  /* Nút nào gửi form: đọc trong `onSubmit` của CÙNG lượt bấm, nên phải là ref — state chỉ đổi ở
     lượt vẽ sau, `onSubmit` sẽ đọc giá trị cũ. `sentToAssign` (state) chỉ để vẽ dấu tích. */
  const assignAfter = useRef(false);
  const [sentToAssign, setSentToAssign] = useState(false);

  /* Ghế riêng: hồ sơ đang sửa thì đọc ghế đã lưu một lần (id ghế để mở giấy tờ thật). */
  const detail = useQuery({
    queryKey: ['software', row?.id, 'detail-seats'],
    queryFn: () => apiFetch<SoftwareDetailRow>(`/api/v1/software/${row?.id}`),
    enabled: Boolean(row?.perSeat),
  });
  /* CHỈ ô người dùng đã sửa, theo số ghế. Không giữ cả dòng: dòng dựng từ "đã lưu" lúc ghế chưa
     về (mạng chậm, lỗi) là chuỗi rỗng, gửi lên thì xoá trắng hợp đồng / ghi chú ở server. */
  const [seatEdits, setSeatEdits] = useState<Record<number, Partial<Pick<SeatDraftRow, 'contract' | 'note'>>>>({});
  const seatDrafts = useRef(new Map<number, AttachmentDraft>());

  /* Đợt mua mới: các hồ sơ cùng tên (để gợi ý mã không trùng và kể ra các đợt trước). */
  const siblings = useQuery({
    queryKey: ['software', 'batches', batchFrom?.name],
    queryFn: () =>
      apiFetch<{ items: SoftwareRow[] }>(`/api/v1/software?kind=license&limit=50&search=${encodeURIComponent(batchFrom?.name ?? '')}`),
    enabled: Boolean(batchFrom),
  });
  const batches = (siblings.data?.items ?? []).filter((item) => item.name === batchFrom?.name && item.kind === batchFrom?.kind);
  const suggestedCode = batchFrom ? nextBatchCode(batchFrom.code, batches.map((item) => item.code)) : '';

  const save = useApiMutation<Record<string, unknown>, { id: string }>(
    row ? `/api/v1/software/${row.id}` : '/api/v1/software',
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  // Trong lúc đẩy giấy tờ lên, `save` đã xong nên `isPending` hết đỏ — không khoá thêm thì
  // nút Lưu mở lại và bấm phát nữa là tạo hồ sơ thứ hai.
  const busy = save.isPending || uploading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      // Đổi sang loại không có seat thì xóa luôn ô seat — gửi lên sẽ bị API từ chối,
      // và giữ lại một con số vô nghĩa trên màn hình chỉ tổ gây hiểu nhầm.
      if (key === 'kind' && !supportsSeats(value as SoftwareKind)) {
        // Đổi sang loại không có seat: xóa seat, và kéo kỳ hạn về thuê bao vì chỉ license
        // mới có bản mua đứt (API cũng chặn, nhưng để form gửi lên rồi bị từ chối thì tệ).
        return {
          ...current,
          kind: value as SoftwareKind,
          seatTotal: '',
          licenseModel: 'subscription',
          perSeat: false,
        };
      }
      // Đánh dấu vĩnh viễn thì bỏ luôn ngày hết hạn — hai thứ đó ngược nhau.
      if (key === 'licenseModel' && value === 'perpetual') {
        return { ...current, licenseModel: 'perpetual', endDate: '' };
      }
      // Ghế riêng cần từ 2 ghế: bớt xuống dưới 2 (hay xoá trống = không giới hạn) thì tự tắt.
      if (key === 'seatTotal' && !(Number(value) >= 2)) {
        return { ...current, seatTotal: value as string, perSeat: false };
      }
      return { ...current, [key]: value };
    });

  const hasSeats = supportsSeats(form.kind);
  const isPerpetual = form.licenseModel === 'perpetual';
  const seats = seatCheck(form.seatTotal, hasSeats, row?.seatUsed ?? 0, row?.seatTotal ?? null);
  const endRequired = requiresEndDate(form.kind, form.licenseModel);
  const hasDomains = supportsWebsites(form.kind);
  const canPerSeat = hasSeats && seats.value !== null && seats.value >= 2;
  const perSeat = canPerSeat && form.perSeat;

  /* Dòng ghế: đủ 1…N theo ô Số ghế; giá trị lấy từ bản đang gõ, không có thì từ ghế đã lưu. */
  const savedSeats = new Map((detail.data?.seats ?? []).map((seat) => [seat.seatNo, seat]));
  const seatList: SeatDraftRow[] = perSeat
    ? Array.from({ length: seats.value ?? 0 }, (_, i) => {
        const seatNo = i + 1;
        const saved = savedSeats.get(seatNo);
        const edit = seatEdits[seatNo] ?? {};
        return {
          seatNo,
          contract: edit.contract ?? saved?.contract ?? '',
          note: edit.note ?? saved?.note ?? '',
        };
      })
    : [];
  const seatIds = new Map((detail.data?.seats ?? []).map((seat) => [seat.seatNo, seat.id]));
  const seatNoteErrors = new Map(
    seatList.map((seat) => [seat.seatNo, secretTextRule(t, seat.note)] as const).filter(([, message]) => Boolean(message)),
  );

  // Khoá động `seat-note-n` (ghi chú từng ghế) — kiểu khoá là chuỗi.
  const check = useFormErrors<string>({
    code: !form.code.trim() && t('formErrors.required'),
    name: !form.name.trim() && t('formErrors.required'),
    // Thuê bao/SSL/tên miền mà không có hạn thì rơi khỏi mọi lời nhắc — API cũng từ chối.
    endDate: endRequired && !form.endDate && t('software.endRequired'),
    seatTotal:
      seats.reason === 'invalid'
        ? t('software.seatInvalid')
        : seats.reason === 'belowUsed'
          ? t('software.seatBelowUsed', { used: row?.seatUsed ?? 0, total: seats.value })
          : null,
    note: secretTextRule(t, form.note),
    // Q-22: hồ sơ Tên miền / SSL là các tên miền dùng chung một hạn — không có tên nào thì nó
    // không theo dõi gì cả.
    websites: hasDomains && websiteLines(form.websites).length === 0 && t('software.domainNamesRequired'),
    ...Object.fromEntries([...seatNoteErrors].map(([seatNo, message]) => [`seat-note-${seatNo}`, message])),
  });

  /** Giấy tờ nháp của từng ghế — sau khi lưu mới có id ghế để treo vào. */
  const uploadSeatDrafts = async (softwareId: string): Promise<void> => {
    const pending = [...seatDrafts.current].filter(([, seatDraft]) => seatDraft.files.length > 0);
    if (pending.length === 0) return;
    const fresh = await apiFetch<SoftwareDetailRow>(`/api/v1/software/${softwareId}`);
    const idOf = new Map((fresh.seats ?? []).map((seat) => [seat.seatNo, seat.id]));
    for (const [seatNo, seatDraft] of pending) {
      const seatId = idOf.get(seatNo);
      if (!seatId) continue;
      const failures = await seatDraft.upload('software_seat', seatId, csrfToken);
      for (const message of failures) toast({ message, tone: 'warn' });
    }
  };

  const title = row
    ? `${t('software.edit')} — ${row.code}`
    : batchFrom
      ? t('software.addBatchTitle', { name: batchFrom.name })
      : t(spec.addKey);

  return (
    <Dialog
      eyebrow={{ label: t(spec.navKey), tone: 'software' }}
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={960}
      title={title}
      footer={
        <>
          <DialogCancel>
            {t('common.cancel')}
          </DialogCancel>
          {/* "Lưu rồi gán vào máy" (Q-27): việc ngay sau khi khai license là đưa nó vào máy. Nút
              chính vẫn là "Lưu"; E2E bấm nút Lưu phải ghi `exact: true`. */}
          {!row && hasSeats ? (
            /* `type="button"` + tự gửi: nút submit ĐẦU TIÊN của form là nút mặc định của phím
               Enter — để nó là submit thì Enter trong một ô thành "Lưu rồi gán". */
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                assignAfter.current = true;
                check.formRef.current?.requestSubmit();
              }}
            >
              {t('software.saveAndAssign')}
            </button>
          ) : null}
          <SubmitButton
            form="software-form"
            busy={busy}
            succeeded={save.isSuccess && !sentToAssign}
            onClick={() => {
              assignAfter.current = false;
            }}
          />
        </>
      }
    >
      <form
        id="software-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          const assign = assignAfter.current;
          assignAfter.current = false;
          setSentToAssign(assign);
          save.mutate(
            {
              code: form.code.trim(),
              name: form.name.trim(),
              kind: form.kind,
              licenseModel: form.licenseModel,
              vendorId: form.vendorId,
              seatTotal: seats.value,
              startDate: form.startDate,
              endDate: form.endDate,
              note: form.note.trim(),
              status: form.status,
              // Đổi loại sang license thì danh sách cũ phải đi theo, không nằm ẩn mà vẫn tìm ra.
              websites: hasDomains ? websiteLines(form.websites) : [],
              ...(hasSeats
                ? {
                    contract: form.contract.trim(),
                    perSeat,
                    ...(perSeat
                      ? {
                          /* Thêm mới: gửi đủ ghế. Sửa: chỉ ô đã sửa — API giữ nguyên ô không gửi
                             (kể cả ghế đã lưu từ lần bật trước mà form không đọc được). */
                          seats: row
                            ? Object.entries(seatEdits)
                                .map(([seatNo, edit]) => ({
                                  seatNo: Number(seatNo),
                                  ...(edit.contract !== undefined ? { contract: edit.contract.trim() } : {}),
                                  ...(edit.note !== undefined ? { note: edit.note.trim() } : {}),
                                }))
                                .filter((seat) => seat.seatNo <= (seats.value ?? 0))
                            : seatList.map((seat) => ({ seatNo: seat.seatNo, contract: seat.contract.trim(), note: seat.note.trim() })),
                        }
                      : {}),
                  }
                : {}),
            },
            {
              onSuccess: (created) => {
                void (async () => {
                  toast({ message: t('software.saved') });
                  const id = row?.id ?? created.id;
                  // Giấy tờ đi SAU khi hồ sơ đã có id — file không thể treo vào cái chưa tồn tại.
                  // Bật ghế riêng thì giấy tờ chung đã ẩn: chỉ đẩy giấy tờ của từng ghế.
                  if (!perSeat && draft.files.length > 0) {
                    setUploading(true);
                    const count = draft.files.length;
                    const failures = await draft.upload('software', id, csrfToken);
                    setUploading(false);
                    if (failures.length < count) {
                      toast({ message: t('attachments.draftUploaded', { count: count - failures.length }) });
                    }
                    for (const message of failures) toast({ message, tone: 'warn' });
                  }
                  if (perSeat) {
                    setUploading(true);
                    await uploadSeatDrafts(id).catch((err) => toast({ message: errorMessage(err), tone: 'warn' }));
                    setUploading(false);
                  }
                  onSaved({ id, assign });
                })();
              },
              onError: (err) => {
                if (!server.claim(err, { SOFTWARE_CODE_TAKEN: 'sw-code' })) setError(errorMessage(err));
              },
            },
          );
        }}
      >
        {/*
          Khối lỗi nằm ở ĐẦU form, không phải ở cuối.

          Đặt ngay trên `</form>` là nằm DƯỚI cả khu Giấy tờ đính kèm: trên một form dài như
          thế này nó rơi ra ngoài màn hình, người dùng bấm Lưu, không thấy gì xảy ra, và bấm
          tiếp vài lần nữa. Câu lỗi có tồn tại cũng như không.
        */}
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        {check.summary}
        {batchFrom ? (
          <p className="alert info" role="note">
            {t('software.batchHint', {
              list: batches.map((item) => `${item.code} (${item.seatTotal ?? '∞'})`).join(' · ') || batchFrom.code,
              code: suggestedCode,
            })}
            {!form.code ? (
              <>
                {' '}
                <button type="button" className="btn sm" onClick={() => set('code', suggestedCode)}>
                  {t('software.batchUseCode', { code: suggestedCode })}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        <FormSection title={hasSeats ? t('software.sectionWhat') : t('software.sectionProfile')} columns={3}>
          {/* Loại đứng ĐẦU: nó quyết định form có Kỳ hạn, Số ghế, Hết hạn hay không — chọn sau
              khi đã gõ mã và tên thì form nhảy bố cục ngay dưới tay người gõ. Màn một loại thì
              không có gì để chọn — không bày ô. */}
          {kinds.length > 1 ? (
            <Field label={t('software.kind')} required span={3}>
              <div className="segmented" role="radiogroup" aria-label={t('software.kind')}>
                {kinds.map((kind) => (
                  <label key={kind}>
                    <input
                      type="radio"
                      name="sw-kind"
                      value={kind}
                      checked={form.kind === kind}
                      onChange={() => set('kind', kind)}
                    />
                    {t(KIND_KEY[kind])}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          {/* Một hàng ba ô (Q-27): tên · mã · nhà cung cấp — "cái gì, gọi là gì, mua của ai". */}
          <Field label={t('software.name')} required htmlFor="sw-name" error={check.error('name')}>
            <input
              id="sw-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label={t('software.code')} required htmlFor="sw-code" error={check.error('code') ?? server.error('sw-code')}>
            <CodeInput
              caps
              id="sw-code"
              required
              placeholder={batchFrom ? suggestedCode : codePrefix(form.kind) ? `${codePrefix(form.kind)}…` : undefined}
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label={t('software.vendor')}>
            <Select
              value={form.vendorId}
              ariaLabel={t('software.vendor')}
              placeholder={`— ${t('software.noVendor')} —`}
              failed={lists.isError}
              options={activeOptions(lists.data?.vendors, row?.vendorId, (vendor) => vendor.name)}
              onChange={(value) => set('vendorId', value)}
            />
          </Field>
          {/*
            Ô Trạng thái CHỈ hiện khi SỬA.

            Thêm mới thì trạng thái luôn là "đang dùng" — bày một ô chọn có đúng một câu trả
            lời hợp lý là bắt người khai đọc và bỏ qua một thứ không có quyết định nào ở đó,
            và mở đường cho một hồ sơ vừa tạo đã ở trạng thái "đã thanh lý".
          */}
          {row ? (
            <Field label={t('software.status')}>
              <Select
                value={form.status}
                ariaLabel={t('software.status')}
                // "Hết hạn" do hệ thống tự đặt theo ngày hết hạn (DOM-03) — người chỉ chọn giữa
                // Đang dùng và Thanh lý. Hồ sơ đang Hết hạn vẫn hiện đúng nhãn của nó.
                options={SOFTWARE_STATUSES.filter(
                  (status) => status !== 'expired_ok' || form.status === 'expired_ok',
                ).map((status) => ({
                  value: status,
                  label: t(STATUS_KEY[status]),
                }))}
                onChange={(value) => set('status', value as SoftwareStatus)}
              />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title={t('software.sectionTerm')} columns={3}>
          {/* Chỉ license mới có bản mua đứt — loại khác không hiện ô này cho đỡ rối. */}
          {hasSeats ? (
            <Field label={t('software.licenseModel')} tip={t('software.licenseModelTip')}>
              <div className="segmented" role="radiogroup" aria-label={t('software.licenseModel')}>
                {LICENSE_MODELS.map((model) => (
                  <label key={model}>
                    <input
                      type="radio"
                      name="sw-model"
                      value={model}
                      checked={form.licenseModel === model}
                      onChange={() => set('licenseModel', model)}
                    />
                    {t(model === 'perpetual' ? 'software.perpetual' : 'software.subscription')}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <Field label={t('software.startDate')}>
            <DatePicker
              value={form.startDate}
              ariaLabel={t('software.startDate')}
              onChange={(value) => set('startDate', value)}
            />
          </Field>
          {/* Vĩnh viễn: ô Hết hạn thành chữ tĩnh thay vì biến mất — bố cục không nhảy. */}
          {isPerpetual ? (
            <Field label={t('software.endDate')}>
              <p className="static-value">{t('software.noEnd')}</p>
            </Field>
          ) : (
            <Field
              label={t('software.endDate')}
              required={endRequired}
              error={check.error('endDate')}
            >
              <DatePicker
                value={form.endDate}
                ariaLabel={t('software.endDate')}
                onChange={(value) => set('endDate', value)}
              />
              <YearQuickPicks
                base={form.startDate}
                onPick={(value) => set('endDate', value)}
                label={t('software.endQuick')}
                needBaseHint={t('software.endQuickNeedBase')}
              />
            </Field>
          )}
        </FormSection>

        {hasSeats ? (
          <FormSection title={t('software.sectionSeatsContract')} columns={3}>
            <Field
              label={t('software.seatTotal')}
              hint={t('software.seatHint')}
              htmlFor="sw-seat"
              error={check.error('seatTotal')}
            >
              {/* − dừng ở số máy đang dùng: thấp hơn là `seatCheck` báo lỗi, nút không nên dẫn
                  người dùng tới đó. Ô trống (không giới hạn) vẫn gõ/xoá tay được. */}
              <NumberStepper
                id="sw-seat"
                label={t('software.seatStepperNoun')}
                min={Math.max(1, row?.seatUsed ?? 0)}
                value={form.seatTotal}
                onChange={(value) => set('seatTotal', value)}
              />
            </Field>
            {perSeat ? null : (
              <Field label={t('software.contract')} hint={t('software.contractHint')} htmlFor="sw-contract">
                <CodeInput
                  id="sw-contract"
                  maxLength={200}
                  value={form.contract}
                  onChange={(e) => set('contract', e.target.value)}
                />
              </Field>
            )}
            <Field label={t('software.perSeat')} htmlFor="sw-per-seat" span={3}>
              <label className="row" style={{ gap: 'var(--space-3)' }}>
                <input
                  id="sw-per-seat"
                  type="checkbox"
                  checked={perSeat}
                  disabled={!canPerSeat}
                  onChange={(e) => set('perSeat', e.target.checked)}
                />
                <span className="muted">
                  {canPerSeat ? t(perSeat ? 'software.perSeatOn' : 'software.perSeatOff') : t('software.perSeatNeedTwo')}
                </span>
              </label>
            </Field>
            {perSeat ? (
              <SeatEditor
                rows={seatList}
                seatIds={seatIds}
                csrfToken={csrfToken}
                disabled={busy}
                noteError={(seatNo) => check.error(`seat-note-${seatNo}`) || undefined}
                onChange={(seatNo, patch) =>
                  setSeatEdits((current) => ({ ...current, [seatNo]: { ...current[seatNo], ...patch } }))
                }
                onDraft={(seatNo, seatDraft) => {
                  if (seatDraft) seatDrafts.current.set(seatNo, seatDraft);
                  else seatDrafts.current.delete(seatNo);
                }}
              />
            ) : null}
          </FormSection>
        ) : null}

        {/* Ghi chú chung — với license bật ghế riêng thì ghi chú nằm ở từng ghế. */}
        {perSeat ? null : (
          <FormSection
            title={hasDomains ? t('software.sectionWebsitesNote') : hasSeats ? t('software.sectionNoteFiles') : undefined}
            columns={3}
          >
            {hasDomains ? (
              <Field
                label={t('software.domainNames')}
                hint={t('software.domainNamesHint')}
                htmlFor="sw-websites"
                required
                error={check.error('websites')}
              >
                <textarea
                  id="sw-websites"
                  className="inp"
                  rows={3}
                  value={form.websites}
                  onChange={(e) => set('websites', e.target.value)}
                />
              </Field>
            ) : null}
            <NoteField
              id="sw-note"
              value={form.note}
              onChange={(v) => set('note', v)}
              span={hasDomains ? 2 : 3}
              error={check.error('note')}
            />
          </FormSection>
        )}

        {/* Hợp đồng license, thư xác nhận SSL, hóa đơn tên miền — chúng nằm sẵn trên tay lúc
            gõ hồ sơ mới, và cũng là thứ hay phải thay bản mới lúc sửa. Thêm mới thì chỉ chọn
            file (đẩy lên sau khi có id); sửa thì dùng thẳng panel giấy tờ, có đủ danh sách
            đang có + tải về + xóa. Bật ghế riêng thì giấy tờ ở từng ghế. */}
        {perSeat ? null : row ? (
          /* Panel này GHI THẲNG: tải lên và xóa bay đi ngay lúc bấm, không nằm trong lượt lưu
             của form. Trong một hộp thoại CÓ nút Hủy thì điều đó không hiển nhiên, nên nút (i)
             cạnh tiêu đề phải nói ra. */
          <FormSection
            title={t('attachments.title')}
            titleTip={t('attachments.liveTip')}
            columns={1}
          >
            <AttachmentPanel
              ownerType="software"
              ownerId={row.id}
              csrfToken={csrfToken}
              canEdit={!busy}
            />
          </FormSection>
        ) : (
          <AttachmentDraftSection draft={draft} disabled={busy} />
        )}

      </form>
    </Dialog>
  );
}
