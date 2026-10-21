import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import type { Me } from "@/lib/me";
import { PATHS } from "@/lib/routes";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { RenewDialog } from "@/ui/renew-dialog";
import { HistoryPanel } from "@/ui/history-panel";
import { AuditLogLink } from "@/ui/audit-log-link";
import { DetailLoadFailed, LoadError, Loading } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { DetailHeader } from "@/ui/detail-header";
import { FactStrip, SpecList } from "@/ui/detail-facts";
import { DetailLayout, DetailSection } from "@/ui/detail-layout";
import { TabPanel, Tabs, initialTab } from "@/ui/tabs";
import { fileCountFact, useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { RowActions } from "@/ui/row-actions";
import { useToast } from "@/ui/toast";
import { lastDisable, toServiceAccountHistory } from "./service-account-history-entries";
import { formatDate } from "@/lib/format";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { ServiceAccountForm } from "./service-account-form";
import { ServiceAccountStatusDialog } from "./service-account-status-dialog";
import {
  KIND_KEY,
  KIND_SHORT_KEY,
  KIND_TONE,
  allowsAnyIp,
  STATUS_KEY,
  STATUS_TONE,
  supportsVpnFields,
  type ServiceAccountHistoryRow,
  type ServiceAccountRow,
} from "./service-account-types";
import { RecordStamp } from "@/ui/record-stamp";

/**
 * Trang hồ sơ một tài khoản dịch vụ.
 *
 * Mật khẩu nằm ở tab **Két sắt** như thiết bị và phần mềm — cùng `VaultPanel`, cùng luật gõ
 * TOTP và tự ẩn. File cấu hình VPN (`.ovpn`, chứng chỉ) đi vào tab **Giấy tờ**.
 */
export function ServiceAccountDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [editing, setEditing] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [params] = useSearchParams();
  /* Fallback PHẢI là "vault": khu Hồ sơ không còn là tab (NET-075), để mặc định 'profile'
     thì thanh tab không sáng ô nào và thân tab rơi vào nhánh Lịch sử chưa tải. */
  const [tab, setTab] = useState(() =>
    initialTab(
      params.get("tab"),
      ["vault", "attachments", "history"],
      "vault",
    ),
  );

  /* Trước mọi nhánh `return` sớm bên dưới: đây là hook, đặt sau `if (isLoading) return` thì
     số hook giữa hai lượt render lệch nhau. */
  const counts = useTabCounts("service_account", id, me);

  const account = useQuery({
    queryKey: ["service-accounts", id],
    queryFn: () =>
      apiFetch<ServiceAccountRow>(`/api/v1/service-accounts/${id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ["service-accounts", id, "history"],
    queryFn: () =>
      apiFetch<ServiceAccountHistoryRow[]>(
        `/api/v1/service-accounts/${id}/history`,
      ),
    // Hỏi sổ ngay khi mở trang: dòng "sửa lần cuối … bởi …" dưới dải 4 ô cần lượt mới nhất (UX-E26).
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["service-accounts"] });

  if (account.isLoading) return <Loading />;
  if (account.isError) {
    // Giữ đường lùi về danh sách, và tách "hồ sơ không còn" (404) khỏi "máy chủ lỗi".
    return (
      <DetailLoadFailed
        error={account.error}
        onRetry={() => void account.refetch()}
        backTo={PATHS.serviceAccounts}
        backLabel={t("nav.serviceAccounts")}
      />
    );
  }

  // Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined:
  // hai nhánh trên đều trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx`.
  if (!account.data) return <Loading />;
  const item = account.data;
  const vpn = supportsVpnFields(item.kind);
  /** Ghi (két, hồ sơ, trạng thái) chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";
  const canEdit = canVaultWrite;
  const nextStatus = item.status === "active" ? "disabled" : "active";
  const disabledInfo = item.status === "disabled" ? lastDisable(history.data ?? []) : null;
  /* Mọi trường chưa nói ở dải 4 ô, theo thứ tự cố định. Nhóm VPN chỉ có nghĩa với VPN. */
  /* Mọi trường chưa nói ở dải 4 ô, theo thứ tự cố định — ô trống ghi "chưa khai". */
  const infoItems = [
    ...(vpn ? [{ label: t("serviceAccounts.groupName"), value: item.groupName }] : []),
    { label: t("serviceAccounts.department"), value: item.department },
    { label: t("serviceAccounts.note"), value: item.note },
    {
      label: t("serviceAccounts.createdBy"),
      value: item.createdBy ? (
        <>
          <span title={item.createdBy}>{item.createdBy.split("@")[0]}</span>
          {" · "}
          {formatDate(item.createdAt)}
        </>
      ) : null,
      present: Boolean(item.createdBy),
    },
  ];
  /* Đếm đúng các ô của khối Thông tin, như trang thiết bị / phần mềm / đường truyền: nút đứng
     ở đầu khối nào thì nói về ô của khối đó. "Khai bởi" do máy ghi — không mời "bổ sung". */
  const infoBlank = infoItems.filter((entry) => !("present" in entry) && !entry.value).length;

  return (
    <>
      <DetailHeader
        crumbs={[
          { label: t("nav.serviceAccounts"), to: PATHS.serviceAccounts },
          { label: t(KIND_KEY[item.kind]) },
          { label: item.code },
        ]}
        code={item.code}
        name={item.name}
        /* Trạng thái đứng dưới mã như mọi trang khuôn C (Q-27), cạnh loại tài khoản. Đã ngừng
           dùng thì KHÔNG vẽ ở đây: băng ngay dưới đã nói, kèm ai đóng, lúc nào, vì sao. */
        subline={
          <>
            {item.status === "disabled" ? null : (
              <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
            )}
            <span className={`badge ${KIND_TONE[item.kind]}`}>{t(KIND_SHORT_KEY[item.kind])}</span>
          </>
        }
        actions={
          canEdit ? (
            <>
              <button type="button" className="btn primary" onClick={() => setEditing(true)}>
                {t("serviceAccounts.edit")}
              </button>
              {/* Gia hạn ngay tại hồ sơ (PW-A14) — cùng RenewDialog với màn Sắp hết hạn. */}
              {item.status === "active" && item.endDate ? (
                <button type="button" className="btn" onClick={() => setRenewing(true)}>
                  {t("expiry.renew")}
                </button>
              ) : null}
              {/* Đổi trạng thái đi hộp RIÊNG vì nó bắt ghi lý do — cùng hộp với danh sách, để
                  không phải quay ra danh sách, tìm dòng rồi mở ⋯ mới đóng được một tài khoản.
                  Đã ngừng dùng thì "Dùng lại…" nằm ở băng cảnh báo ngay dưới; menu chỉ còn đúng
                  mục đó thì là một nút thứ hai cho cùng một việc, nên bỏ hẳn. */}
              {item.status === "active" ? (
                <RowActions
                  label={t("common.actionsOf", { subject: item.code })}
                  items={[
                    {
                      key: "disable",
                      label: t("serviceAccounts.disableMenu"),
                      onSelect: () => setSwitching(true),
                      warn: true,
                    },
                  ]}
                />
              ) : null}
            </>
          ) : null
        }
      />

      {/* Đã vô hiệu hóa: nói NGAY đầu trang ai đóng, lúc nào, vì sao — không bắt mở tab Lịch
          sử — kèm đường mở lại cho người có quyền. */}
      {disabledInfo || item.status === "disabled" ? (
        <div className="alert warn" role="note">
          <p>
            {disabledInfo
              ? t("serviceAccounts.disabledBy", {
                  date: formatDate(disabledInfo.at),
                  by: disabledInfo.actor,
                  reason: disabledInfo.reason ?? "—",
                })
              : t("serviceAccounts.statusDisabled")}
          </p>
          {canEdit ? (
            <button type="button" className="btn sm" onClick={() => setSwitching(true)}>
              {t("serviceAccounts.enableMenu")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/*
        Dải 4 ô (khuôn C, Q-27). TÊN ĐĂNG NHẬP đứng ô đầu, có nút chép — nó là thứ người ta mở
        trang này để lấy, và là thứ dán thẳng vào ô đăng nhập. Ô thứ tư: VPN thì dải IP được
        phép (mở cho mọi IP nguồn là điều người kiểm toán phải thấy ngay), tài khoản dùng chung
        không có trường đó nên là Giấy tờ.
      */}
      <FactStrip
        label={t("serviceAccounts.factsLabel")}
        facts={[
          {
            key: "login",
            label: t("serviceAccounts.login"),
            value: item.login ? (
              <>
                <span className="mono sa-login">{item.login}</span>
                <CopyButton value={item.login} label={t("serviceAccounts.copyLogin")} inline />
              </>
            ) : null,
          },
          {
            key: "owner",
            label: t("serviceAccounts.ownerName"),
            value: item.ownerName,
          },
          {
            /* Hạn dùng (Q-20): cùng huy hiệu với danh sách. Không có mốc đầu riêng nên không vẽ
               thanh thời gian — một thanh chỉ có đích là thanh nói sai. Đã ngừng dùng thì
               huy hiệu xám "không tính hạn". */
            key: "end",
            label: t("serviceAccounts.endDate"),
            value: <ExpiryBadge end={item.endDate} notCounted={item.status === "disabled"} />,
            note: item.endDate ? formatDate(item.endDate) : null,
          },
          vpn
            ? {
                key: "ips",
                label: t("serviceAccounts.allowedIps"),
                value: (
                  <>
                    {item.allowedIps ? <span className="mono">{item.allowedIps}</span> : null}
                    {allowsAnyIp(item.kind, item.allowedIps) ? (
                      <>
                        {item.allowedIps ? " " : null}
                        <span className="badge warn" title={t("serviceAccounts.anyIpTitle")}>
                          {t("serviceAccounts.anyIp")}
                        </span>
                      </>
                    ) : null}
                  </>
                ),
              }
            : {
                key: "files",
                label: t("serviceAccounts.tabAttachments"),
                value: fileCountFact(counts, (count) => t("serviceAccounts.fileCount", { count })),
              },
        ]}
      />
      <RecordStamp createdAt={item.createdAt} last={history.data?.[0]} onOpenHistory={() => setTab("history")} />

      <DetailLayout>

      {/* Thông tin đứng NGAY đầu cột chính, không sau một tab: khu này ngắn, và két — thứ người
          ta mở trang này để tìm — vẫn là tab đầu ngay bên dưới. Ô trống đứng đúng chỗ, ghi
          "chưa khai" (Q-27). */}
      <DetailSection
        title={t("serviceAccounts.infoTitle")}
        action={
          canEdit && infoBlank > 0 ? (
            <button type="button" className="btn sm" onClick={() => setEditing(true)}>
              {t("serviceAccounts.fillBlanks", { count: infoBlank })}
            </button>
          ) : null
        }
      >
        <SpecList label={t("serviceAccounts.infoTitle")} items={infoItems} />
      </DetailSection>

      <Tabs
        items={[
          { key: "vault", label: t("vault.tab"), count: counts.secrets },
          {
            key: "attachments",
            label: t("serviceAccounts.tabAttachments"),
            count: counts.files,
          },
          { key: "history", label: t("serviceAccounts.tabHistory") },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("serviceAccounts.title")}
      />

      <TabPanel tabKey={tab}>
        {tab === "vault" ? (
          <VaultPanel
            ownerType="service_account"
            ownerId={item.id}
            ownerLabel={item.code}
            me={me}
            canEdit={canVaultWrite}
          />
        ) : tab === "attachments" ? (
          <AttachmentPanel
            ownerType="service_account"
            ownerId={item.id}
            csrfToken={me.csrfToken}
          />
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <>
            <AuditLogLink role={me.role} objectType="service_account" objectId={item.id} />
            <HistoryPanel entries={toServiceAccountHistory(history.data ?? [], t)} />
          </>
        )}
      </TabPanel>
      </DetailLayout>

      {renewing && item.endDate ? (
        <RenewDialog
          row={{ kind: "service_account", id: item.id, label: item.name, code: item.code, end: item.endDate }}
          kindLabel={t("nav.serviceAccounts")}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(false)}
          onDone={() => {
            setRenewing(false);
            void refresh();
          }}
        />
      ) : null}
      {editing ? (
        <ServiceAccountForm
          row={item}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(false)}
          onSaved={(warnings) => {
            setEditing(false);
            // Câu "Đã lưu" do chính form nói; ở đây chỉ còn các cảnh báo không chặn lưu.
            for (const warning of warnings) toast({ message: warning, tone: "warn" });
            void refresh();
          }}
        />
      ) : null}

      {switching ? (
        <ServiceAccountStatusDialog
          row={item}
          next={nextStatus}
          csrfToken={me.csrfToken}
          onClose={() => setSwitching(false)}
          onDone={() => {
            setSwitching(false);
            toast({
              message: t(nextStatus === "disabled" ? "serviceAccounts.disabled" : "serviceAccounts.enabled"),
            });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}


