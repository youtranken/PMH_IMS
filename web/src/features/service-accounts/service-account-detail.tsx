import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import type { Me } from "@/lib/me";
import { PATHS } from "@/lib/routes";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { HistoryPanel } from "@/ui/history-panel";
import { AuditLogLink } from "@/ui/audit-log-link";
import { DetailLoadFailed, LoadError, Loading } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  DetailSection,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { TabPanel, Tabs, initialTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { RowActions } from "@/ui/row-actions";
import { useToast } from "@/ui/toast";
import { lastDisable, toServiceAccountHistory } from "./service-account-history-entries";
import { formatDate } from "@/lib/format";
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
  const [switching, setSwitching] = useState(false);
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() =>
    initialTab(params.get("tab"), [
      "profile",
      "vault",
      "attachments",
      "history",
    ]),
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
    // Tài khoản đã vô hiệu hóa thì băng rôn đầu trang phải nói ai, lúc nào, vì sao — câu đó
    // chỉ nằm trong sổ lịch sử, nên hỏi sổ ngay cả khi chưa mở tab.
    enabled: tab === "history" || account.data?.status === "disabled",
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
  // hai nhánh trên đều trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx` (lỗi F-02).
  if (!account.data) return <Loading />;
  const item = account.data;
  const vpn = supportsVpnFields(item.kind);
  /** Ghi (két, hồ sơ, trạng thái) chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";
  const canEdit = canVaultWrite;
  const nextStatus = item.status === "active" ? "disabled" : "active";
  const disabledInfo = item.status === "disabled" ? lastDisable(history.data ?? []) : null;

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
        subline={
          <span className={`badge ${KIND_TONE[item.kind]}`}>{t(KIND_SHORT_KEY[item.kind])}</span>
        }
        actions={
          canEdit ? (
            <>
              <button type="button" className="btn primary" onClick={() => setEditing(true)}>
                {t("serviceAccounts.edit")}
              </button>
              {/* Đổi trạng thái đi hộp RIÊNG vì nó bắt ghi lý do — cùng hộp với danh sách, để
                  không phải quay ra danh sách, tìm dòng rồi mở ⋯ mới đóng được một tài khoản. */}
              <RowActions
                label={t("common.actionsOf", { subject: item.code })}
                items={[
                  item.status === "active"
                    ? {
                        key: "disable",
                        label: t("serviceAccounts.disableMenu"),
                        onSelect: () => setSwitching(true),
                        danger: true,
                      }
                    : {
                        key: "enable",
                        label: t("serviceAccounts.enableMenu"),
                        onSelect: () => setSwitching(true),
                      },
                ]}
              />
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

      <DetailLayout
        rail={
          <RailCard title={t("detail.identityCard")}>
            {/* TÊN ĐĂNG NHẬP đứng dòng đầu, cỡ đọc được, có nút chép — nó là thứ người ta mở
                trang này để lấy, và là thứ dán thẳng vào ô đăng nhập. */}
            {item.login ? (
              <RailRow label={t("serviceAccounts.login")}>
                <span className="mono sa-login">{item.login}</span>{" "}
                <CopyButton value={item.login} label={t("serviceAccounts.copyLogin")} inline />
              </RailRow>
            ) : null}
            <RailRow label={t("serviceAccounts.status")}>
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </RailRow>
            {/* Cùng luật với trang thiết bị: chưa có người phụ trách thì bộ phận đứng thành
                dòng riêng, đừng để nó biến mất theo. */}
            {item.ownerName ? (
              <RailRowIfSet
                label={t("serviceAccounts.ownerName")}
                value={item.ownerName}
                note={item.department ?? undefined}
              />
            ) : (
              <RailRowIfSet label={t("serviceAccounts.department")} value={item.department} />
            )}
            {/* Nhóm VPN và dải IP được phép CHỈ có nghĩa với tài khoản VPN — hồ sơ dùng chung
                không có hai trường đó, vẽ ra là hai dòng chết. */}
            {vpn ? (
              <RailRowIfSet label={t("serviceAccounts.groupName")} value={item.groupName} />
            ) : null}
            {/* Dải IP được phép: mono, và "mọi IP" (trống hoặc 0.0.0.0/0) mang huy hiệu cảnh báo
                — VPN mở cho mọi IP nguồn là điều người kiểm toán phải thấy ngay. */}
            {vpn ? (
              <RailRow label={t("serviceAccounts.allowedIps")}>
                {item.allowedIps ? <span className="mono">{item.allowedIps}</span> : null}
                {allowsAnyIp(item.kind, item.allowedIps) ? (
                  <>
                    {" "}
                    <span className="badge warn" title={t("serviceAccounts.anyIpTitle")}>
                      {t("serviceAccounts.anyIp")}
                    </span>
                  </>
                ) : null}
              </RailRow>
            ) : null}
            {item.createdBy ? (
              <RailRow label={t("serviceAccounts.createdBy")}>
                <span title={item.createdBy}>{item.createdBy.split("@")[0]}</span>
                {" · "}
                {formatDate(item.createdAt)}
              </RailRow>
            ) : null}
          </RailCard>
        }
      >

      <Tabs
        items={[
          { key: "profile", label: t("serviceAccounts.tabProfile") },
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
        {tab === "profile" ? (
          <>
            {/* Loại · tên đăng nhập ĐÃ nằm ở dòng định danh dưới tiêu đề; trạng thái · người
                phụ trách · bộ phận · nhóm VPN · dải IP ĐÃ nằm ở thẻ định danh bên phải. Lưới
                này chỉ còn thứ chưa nói ở đâu cả, và ô trống thì KHÔNG vẽ. */}
            {/* Khu "Hồ sơ" có thẻ + tiêu đề như mọi khu khác — xem chú thích dài ở
                `ui/detail-layout.tsx`, chỗ khai `DetailSection`. KHÔNG `compact`: khu này đứng
                một mình trong cột chính, thứ để mắt so là thẻ định danh bên phải. */}
            <DetailSection title={t("detail.profileSection")}>
              <dl className="data-grid">
                <DataItemIfSet label={t("serviceAccounts.note")} value={item.note} />
              </dl>
              <BlankFields
                labels={[
                  item.login ? null : t("serviceAccounts.login"),
                  item.ownerName ? null : t("serviceAccounts.ownerName"),
                  item.department ? null : t("serviceAccounts.department"),
                  item.note ? null : t("serviceAccounts.note"),
                ].filter((label): label is string => label !== null)}
              />
            </DetailSection>
          </>
        ) : tab === "vault" ? (
          <VaultPanel
            ownerType="service_account"
            ownerId={item.id}
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


