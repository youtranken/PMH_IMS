import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { noteContainsSecret } from '@/lib/note-secret';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Dialog } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { SecretStrengthMeter } from '@/ui/secret-strength-meter';
import { SecretValueInput } from '@/ui/secret-value-input';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { useToast } from '@/ui/toast';
import { useDepartments } from '@/ui/use-departments';
import { secretTextRule, useFormErrors } from '@/ui/use-form-errors';
import {
  KIND_KEY,
  SERVICE_ACCOUNT_KINDS,
  allowsAnyIp,
  previewCodeFromLogin,
  invalidAllowedIps,
  supportsVpnFields,
  type ServiceAccountKind,
  type ServiceAccountRow,
  type ServiceAccountStatus,
} from './service-account-types';

interface FormState {
  code: string;
  kind: ServiceAccountKind;
  name: string;
  login: string;
  department: string;
  ownerName: string;
  groupName: string;
  allowedIps: string;
  note: string;
  status: ServiceAccountStatus;
}

function initialState(row: ServiceAccountRow | null): FormState {
  return {
    code: row?.code ?? '',
    kind: row?.kind ?? 'shared',
    name: row?.name ?? '',
    login: row?.login ?? '',
    department: row?.department ?? '',
    ownerName: row?.ownerName ?? '',
    groupName: row?.groupName ?? '',
    allowedIps: row?.allowedIps ?? '',
    note: row?.note ?? '',
    status: row?.status ?? 'active',
  };
}

/**
 * Form tài khoản dịch vụ. Màn nhập — desktop-first.
 *
 * Một hộp cho CẢ HAI loại, và ô nào chỉ thuộc một loại thì chỉ hiện với loại đó — đúng khuôn
 * của form Phần mềm (ô Số seat chỉ hiện với license). Đổi loại sang "dùng chung" thì xóa
 * luôn nhóm VPN và dải IP đang gõ dở: gửi lên sẽ bị API từ chối, mà giữ lại trên màn hình chỉ
 * tổ làm người dùng tưởng nó vẫn được lưu.
 */
export function ServiceAccountForm({
  row,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  row: ServiceAccountRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  /** Cất mật khẩu vào két đòi step-up — hook lo phần hỏi mã rồi cất lại. */
  const stepUp = useStepUpRetry(csrfToken);
  const departments = useDepartments();
  const [form, setForm] = useState<FormState>(() => initialState(row));
  const [error, setError] = useState<string | null>(null);
  const draft = useAttachmentDraft();
  const [uploading, setUploading] = useState(false);
  /*
   * Mật khẩu cất kèm NGAY trong popup thêm mới.
   *
   * Không thì phải: lưu hồ sơ → đóng popup → bấm vào mã → sang tab Két sắt → bấm Cất secret.
   * Năm bước cho một việc người ta luôn làm liền sau khi khai tài khoản, nên phần lớn sẽ để
   * đó "làm sau" — và mật khẩu ở lại trong file Excel hay tin nhắn Zalo, đúng chỗ IMS sinh ra
   * để dọn đi.
   *
   * CHỈ ở lượt tạo mới: sửa hồ sơ thì két đã có tab riêng với đủ xoay/thu hồi/nhật ký, nhét
   * thêm một ô mật khẩu vào đó chỉ tạo ra hai đường ghi cho cùng một thứ.
   */
  const [secretValue, setSecretValue] = useState('');

  const save = useApiMutation<Record<string, unknown>, ServiceAccountRow>(
    row ? `/api/v1/service-accounts/${row.id}` : '/api/v1/service-accounts',
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  const busy = save.isPending || uploading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      if (key === 'kind' && !supportsVpnFields(value as ServiceAccountKind)) {
        return { ...current, kind: value as ServiceAccountKind, groupName: '', allowedIps: '' };
      }
      return { ...current, [key]: value };
    });

  const vpn = supportsVpnFields(form.kind);
  // Mã suy từ tên đăng nhập — thiếu cả hai thì hồ sơ không có gì để gọi tên.
  const badIps = vpn ? invalidAllowedIps(form.allowedIps) : [];
  // Ghi chú hồ sơ là cột rõ (FR-035): chứa mật khẩu đang cất là đi vòng qua két. Báo ngay khi
  // gõ như hộp két; server vẫn chặn lần nữa lúc cất.
  const noteLeak =
    !row && noteContainsSecret(form.note, secretValue) && t('vault.noteContainsSecret');
  const check = useFormErrors({
    note: noteLeak,
    login: !form.code.trim() && !form.login.trim() && t('serviceAccounts.loginOrCodeRequired'),
    allowedIps:
      badIps.length > 0 && t('serviceAccounts.allowedIpsInvalid', { list: badIps.join(', ') }),
    note: secretTextRule(t, form.note),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      // Đang ghi thì không cho đóng bằng Esc / bấm nền: hộp đóng nhưng chuỗi `await` bên dưới
      // vẫn chạy tiếp và ghi nốt, nên người dùng tin là đã hủy trong khi dữ liệu đã vào.
      dismissible={!busy}
      guardUnsaved
      maxWidth={1000}
      title={row ? `${t('serviceAccounts.edit')} — ${row.code}` : t('serviceAccounts.add')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="sa-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="sa-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(
            {
              code: form.code.trim(),
              kind: form.kind,
              name: form.name.trim(),
              login: form.login.trim(),
              department: form.department.trim(),
              ownerName: form.ownerName.trim(),
              groupName: vpn ? form.groupName.trim() : '',
              allowedIps: vpn ? form.allowedIps.trim() : '',
              note: form.note.trim(),
            },
            {
              onSuccess: (created) => {
                void (async () => {
                  /*
                   * KHÓA NGAY ĐẦU khối này, không phải chỉ quanh bước tải tệp.
                   *
                   * `busy = save.isPending || uploading`, mà `save.isPending` về false ngay khi
                   * mutation settle — tức là ngay trước dòng này. Trong suốt thời gian `await`
                   * cất mật khẩu vào két bên dưới, nút Lưu SÁNG LẠI: bấm lần hai là POST thêm
                   * một tài khoản dịch vụ trùng. `isp-form.tsx` đã mô tả đúng cái bẫy này
                   * nhưng bản SA không bịt.
                   */
                  setUploading(true);
                  try {
                  toast({ message: t('serviceAccounts.saved') });
                  /*
                   * Cất mật khẩu là việc RIÊNG sau khi hồ sơ đã có id — không gộp vào cùng
                   * một request được, vì két gắn theo `ownerId`. Hỏng ở bước này thì hồ sơ
                   * VẪN còn: báo cho người dùng biết để họ vào tab Két sắt cất lại, chứ đừng
                   * nuốt lỗi rồi để họ tin là mật khẩu đã nằm trong két.
                   */
                  if (!row && secretValue) {
                    try {
                      // Cất vào két đòi step-up: `run` gặp `STEPUP_REQUIRED` thì hỏi
                      // mã 6 số rồi cất lại — hồ sơ đã tạo xong ở trên nên không mất gì.
                      await stepUp.run(() =>
                        apiFetch('/api/v1/vault/secrets', {
                          method: 'POST',
                          csrfToken,
                          body: JSON.stringify({
                            ownerType: 'service_account',
                            ownerId: created.id,
                            kind: 'password',
                            label: t('serviceAccounts.secretLabel'),
                            username: form.login.trim(),
                            value: secretValue,
                          }),
                        }),
                      );
                      toast({ message: t('serviceAccounts.secretSaved') });
                    } catch (err) {
                      /*
                       * TONE phải theo NHÁNH, không hạ hết về `warn`.
                       *
                       * Đóng hộp hỏi mã = người dùng chủ động bỏ qua bước cất: `warn` đúng.
                       * Nhưng một lỗi THẬT (500, trùng nhãn 409, mất mạng) mà cũng `warn` thì
                       * nó chỉ hiện 4 giây thay vì 7 — trong đúng luồng mà mật khẩu vừa gõ sẽ
                       * không lấy lại được sau khi hộp đóng.
                       */
                      const cancelled = (err as Error).message === 'STEPUP_CANCELLED';
                      toast({
                        message: cancelled
                          ? t('serviceAccounts.secretSkipped')
                          : errorMessage(err),
                        tone: cancelled ? 'warn' : 'error',
                      });
                    }
                  }
                  if (draft.files.length > 0) {
                    const count = draft.files.length;
                    const failures = await draft.upload(
                      'service_account',
                      row?.id ?? created.id,
                      csrfToken,
                    );
                    if (failures.length < count) {
                      toast({
                        message: t('attachments.draftUploaded', {
                          count: count - failures.length,
                        }),
                      });
                    }
                    for (const message of failures) toast({ message, tone: 'warn' });
                  }
                  onSaved(created.warnings ?? []);
                  } finally {
                    setUploading(false);
                  }
                })();
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <FormSection title={t('serviceAccounts.sectionProfile')} columns={4}>
          {/*
            TÊN ĐĂNG NHẬP đứng đầu và là ô bắt buộc — nó là thứ người khai THẬT SỰ biết.

            "Mã" và "tên gọi" là thứ hệ thống cần chứ người dùng không cần: bắt gõ là bắt bịa,
            và mỗi người bịa một kiểu, đúng thứ làm cột mã trở nên vô dụng. Để trống thì API
            suy mã từ tên đăng nhập (`codeFromLogin`) và lấy tên đăng nhập làm tên gọi. Cả hai
            ô vẫn còn đó cho ai muốn tự đặt.
          */}
          {/*
            Bắt buộc CÓ ĐIỀU KIỆN: chỉ khi ô Mã còn trống.

            Vì mã được suy TỪ tên đăng nhập — không có cả hai thì hồ sơ không có gì để gọi tên.
            Nhưng ai đã tự đặt mã thì không việc gì phải ép họ khai thêm tên đăng nhập: có tài
            khoản dịch vụ đăng nhập bằng chứng thư, bằng khóa SSH, không có username nào cả.
          */}
          <Field
            label={t('serviceAccounts.login')}
            required={!form.code.trim()}
            hint={t('serviceAccounts.loginHint')}
            htmlFor="sa-login"
            error={check.error('login')}
          >
            <input
              id="sa-login"
              className="inp mono"
              required={!form.code.trim()}
              placeholder={t('serviceAccounts.phLogin')}
              value={form.login}
              onChange={(e) => set('login', e.target.value)}
            />
          </Field>
          {/*
            Loại CHỈ chọn lúc tạo. Đổi VPN ↔ dùng chung trên một hồ sơ đang có là lặng lẽ xoá
            nhóm VPN và dải IP (hai trường chỉ thuộc VPN) — và "tài khoản này là VPN hay email
            chung" là thứ người khác đang tra theo. Khai nhầm loại thì vô hiệu hóa và khai lại.
          */}
          {row ? (
            <Field label={t('serviceAccounts.kind')} tip={t('serviceAccounts.kindLocked')}>
              <p className="static-value">{t(KIND_KEY[form.kind])}</p>
            </Field>
          ) : (
            <Field label={t('serviceAccounts.kind')} required tip={t('serviceAccounts.kindHint')}>
              <Select
                required
                value={form.kind}
                ariaLabel={t('serviceAccounts.kind')}
                options={SERVICE_ACCOUNT_KINDS.map((kind) => ({
                  value: kind,
                  label: t(KIND_KEY[kind]),
                }))}
                onChange={(value) => set('kind', value as ServiceAccountKind)}
              />
            </Field>
          )}

          {/* Mã là thứ người khác tra theo (phiếu, email, két): vẫn sửa được khi khai nhầm, nhưng
              nói trước hậu quả ngay khi nó bị đổi. */}
          <Field
            label={t('serviceAccounts.code')}
            hint={
              row
                ? form.code.trim() !== row.code
                  ? t('serviceAccounts.codeChangeWarn', { code: row.code })
                  : undefined
                : /* Mã sẽ sinh ra hiện NGAY khi gõ tên đăng nhập — không phải lưu xong mới biết. */
                  !form.code.trim() && form.login.trim()
                  ? t('serviceAccounts.codePreview', { code: previewCodeFromLogin(form.login) })
                  : t('serviceAccounts.codeAutoHint')
            }
            htmlFor="sa-code"
          >
            <input
              id="sa-code"
              className="inp mono"
              placeholder={t('serviceAccounts.codeAutoPlaceholder')}
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field
            label={t('serviceAccounts.name')}
            hint={row ? undefined : t('serviceAccounts.nameAutoHint')}
            htmlFor="sa-name"
          >
            <input
              id="sa-name"
              className="inp"
              placeholder={form.login || undefined}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          {/*
            KHÔNG có ô Trạng thái trong form — kể cả ô chỉ đọc. Đổi trạng thái đi `PATCH
            :id/disable` / `:id/enable` (menu ⋯ ở trang hồ sơ và danh sách), hai đường DUY NHẤT
            bắt ghi lý do; API đã bỏ `status` khỏi DTO sửa. Một ô chữ chết chiếm cả một ô lưới
            chỉ để nói "không sửa ở đây" là tốn chỗ cho một câu trạng thái đã có ở đầu trang.
          */}
        </FormSection>

        <FormSection title={t('serviceAccounts.sectionOwner')} columns={4}>
          <Field label={t('serviceAccounts.department')}>
            {/* Cùng danh mục Bộ phận với hồ sơ IP và sổ NAT — ba chỗ trả lời cùng một câu,
                viết lệch nhau thì lọc chéo không ra. */}
            <SuggestInput
              value={form.department}
              onChange={(value) => set('department', value)}
              options={departments.names}
              failed={departments.failed}
              placeholder={t('serviceAccounts.departmentPlaceholder')}
              ariaLabel={t('serviceAccounts.department')}
            />
          </Field>
          <Field
            label={t('serviceAccounts.ownerName')}
            tip={t('serviceAccounts.ownerNameHint')}
            htmlFor="sa-owner"
            span={2}
          >
            <input
              id="sa-owner"
              className="inp"
              value={form.ownerName}
              onChange={(e) => set('ownerName', e.target.value)}
            />
          </Field>
        </FormSection>

        {/* Khối này CHỈ hiện với tài khoản VPN — hai ô của nó vô nghĩa với email dùng chung,
            và khai vào là ghi ra dữ liệu mà sáu tháng sau không ai dám xóa. */}
        {vpn ? (
          <FormSection title={t('serviceAccounts.sectionVpn')} columns={4}>
            <Field
              label={t('serviceAccounts.groupName')}
              hint={t('serviceAccounts.groupNameHint')}
              htmlFor="sa-group"
            >
              {/* Không mono: tên nhóm do người đặt ("VPN kinh doanh"), không phải mã hay IP. */}
              <input
                id="sa-group"
                className="inp"
                value={form.groupName}
                onChange={(e) => set('groupName', e.target.value)}
              />
            </Field>
            {/* Kiểm TỪNG mục ngay khi gõ (lỗi chặn lưu), và "mọi IP" (trống / 0.0.0.0/0) nói
                ra ngay ở dòng gợi ý — VPN mở cho mọi IP nguồn phải là quyết định có chủ ý. */}
            <Field
              label={t('serviceAccounts.allowedIps')}
              hint={
                allowsAnyIp(form.kind, form.allowedIps)
                  ? t('serviceAccounts.allowedIpsAnyWarn')
                  : t('serviceAccounts.allowedIpsHint')
              }
              htmlFor="sa-ips"
              span={2}
              error={check.error('allowedIps')}
            >
              <textarea
                id="sa-ips"
                className="inp mono"
                rows={2}
                placeholder={t('serviceAccounts.phAllowedIps')}
                value={form.allowedIps}
                onChange={(e) => set('allowedIps', e.target.value)}
              />
            </Field>
          </FormSection>
        ) : null}

        {/*
          Cất mật khẩu NGAY tại đây — chỉ ở lượt thêm mới.

          Đây là việc người ta luôn làm liền sau khi khai một tài khoản dịch vụ. Bắt đi năm
          bước (lưu → đóng → mở hồ sơ → sang tab Két sắt → bấm Cất secret) thì phần lớn sẽ để
          "làm sau", và mật khẩu ở lại trong Excel hay tin nhắn Zalo — đúng chỗ IMS sinh ra để
          dọn đi. Bỏ trống vẫn lưu được: có tài khoản chưa ai cầm mật khẩu.
        */}
        {row ? null : (
          <FormSection title={t('serviceAccounts.sectionSecret')} columns={1}>
            <Field
              label={t('serviceAccounts.secretValue')}
              hint={t('serviceAccounts.secretHint')}
              htmlFor="sa-secret"
            >
              <SecretValueInput
                id="sa-secret"
                value={secretValue}
                onChange={setSecretValue}
                allowGenerate
                required={false}
              />
              <SecretStrengthMeter value={secretValue} />
            </Field>
          </FormSection>
        )}

        {/* Khu chỉ có ĐÚNG một ô, nên tiêu đề khu và nhãn ô nói y hệt nhau, hai dòng chồng
            nhau cách nhau 8px. Bỏ tiêu đề khu — nhãn ô mới là thứ ô nhập cần. */}
        <FormSection columns={1}>
          <Field
            label={t('serviceAccounts.note')}
            hint={t('serviceAccounts.noteHint')}
            htmlFor="sa-note"
            error={noteLeak || check.error('note')}
          >
            <textarea
              id="sa-note"
              className="inp"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </FormSection>

        {row ? (
          /* Panel này GHI THẲNG: tải lên và xóa bay đi ngay lúc bấm, không nằm trong lượt lưu
             của form. Trong một hộp thoại CÓ nút Hủy thì điều đó không hiển nhiên, nên nói ra —
             ở nút (i) cạnh tiêu đề, không phải một băng cảnh báo làm hộp cao thêm. */
          <FormSection
            title={t('attachments.title')}
            titleTip={t('attachments.liveTip')}
            columns={1}
          >
            <AttachmentPanel
              ownerType="service_account"
              ownerId={row.id}
              csrfToken={csrfToken}
              canEdit={!busy}
            />
          </FormSection>
        ) : (
          <AttachmentDraftSection draft={draft} disabled={busy} />
        )}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {/* Hộp hỏi mã 6 số khi server đòi step-up (C2). */}
      {stepUp.dialog}
    </Dialog>
  );
}
