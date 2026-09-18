import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { Me } from "@/lib/me";
import { PATHS } from "@/lib/routes";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { TabPanel, Tabs, initialTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { toServiceAccountHistory } from "./service-account-history-entries";
import {
  KIND_KEY,
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
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
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
    enabled: tab === "history",
  });

  void queryClient;

  if (account.isLoading) return <Loading />;
  if (account.isError) {
    return account.error instanceof ApiError && account.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError error={account.error} onRetry={() => void account.refetch()} />
    );
  }

  const item = account.data!;
  const vpn = supportsVpnFields(item.kind);
  /** Ghi vào két chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";

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
          <>
            <span className="badge plain brand">{t(KIND_KEY[item.kind])}</span>
            {item.login ? (
              <span>
                {t("serviceAccounts.login")}: <span className="mono">{item.login}</span>
                <CopyButton value={item.login} label={t("serviceAccounts.copyLogin")} />
              </span>
            ) : null}
          </>
        }
      />

      <DetailLayout
        rail={
          <RailCard title={t("detail.identityCard")}>
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
            {vpn ? (
              <RailRowIfSet label={t("serviceAccounts.allowedIps")} value={item.allowedIps} />
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
          <HistoryPanel entries={toServiceAccountHistory(history.data ?? [], t)} />
        )}
      </TabPanel>
      </DetailLayout>
    </>
  );
}


