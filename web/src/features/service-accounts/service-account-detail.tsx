import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { orDash } from "@/lib/format";
import type { Me } from "@/lib/me";
import { PATHS } from "@/lib/routes";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { PageHeader } from "@/ui/page-header";
import { TabPanel, Tabs } from "@/ui/tabs";
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
 * Tab mở sẵn đọc từ URL, CÓ KIỂM: chuỗi lạ phải rơi về 'profile'.
 *
 * Chuỗi ternary render kết thúc ở nhánh Lịch sử, nên `?tab=rác` không kiểm sẽ vẽ một tab
 * Lịch sử RỖNG mà không tab nào sáng — và vì truy vấn lịch sử `enabled: tab === 'history'`
 * nên nó còn chẳng gọi API: `isLoading`/`isError` đều false, `HistoryPanel` nhận mảng rỗng.
 * Một link cũ gõ sai một chữ sẽ hiện ra "hồ sơ này chưa có lịch sử gì" một cách rất thuyết phục.
 */
function initialTab(raw: string | null, allowed: string[]): string {
  return raw && allowed.includes(raw) ? raw : "profile";
}

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
      <LoadError onRetry={() => void account.refetch()} />
    );
  }

  const item = account.data!;
  const vpn = supportsVpnFields(item.kind);
  /** Ghi vào két chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";

  return (
    <>
      <PageHeader
        title={`${item.code} — ${item.name}`}
        subtitle={t(KIND_KEY[item.kind])}
        actions={
          <Link className="btn" to={PATHS.serviceAccounts}>
            {t("serviceAccounts.back")}
          </Link>
        }
      />

      <div className="device-summary">
        <span className={`badge ${STATUS_TONE[item.status]}`}>
          {t(STATUS_KEY[item.status])}
        </span>
        {item.login ? (
          <span className="muted">
            {t("serviceAccounts.login")}:{" "}
            <span className="mono">{item.login}</span>
          </span>
        ) : null}
      </div>

      <Tabs
        items={[
          { key: "profile", label: t("serviceAccounts.tabProfile") },
          { key: "vault", label: t("vault.tab") },
          { key: "attachments", label: t("serviceAccounts.tabAttachments") },
          { key: "history", label: t("serviceAccounts.tabHistory") },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("serviceAccounts.title")}
      />

      <TabPanel tabKey={tab}>
        {tab === "profile" ? (
          <dl className="data-grid">
            <Item label={t("serviceAccounts.kind")}>
              {t(KIND_KEY[item.kind])}
            </Item>
            <Item label={t("serviceAccounts.login")}>{orDash(item.login)}</Item>
            <Item label={t("serviceAccounts.department")}>
              {orDash(item.department)}
            </Item>
            <Item label={t("serviceAccounts.ownerName")}>
              {orDash(item.ownerName)}
            </Item>
            {/* Hai ô VPN chỉ hiện với tài khoản VPN — với email dùng chung chúng luôn rỗng,
                và một hàng "—" chỉ làm người đọc dừng lại tự hỏi. */}
            {vpn ? (
              <>
                <Item label={t("serviceAccounts.groupName")}>
                  <span className="mono">{orDash(item.groupName)}</span>
                </Item>
                <Item label={t("serviceAccounts.allowedIps")}>
                  <span className="mono">{orDash(item.allowedIps)}</span>
                </Item>
              </>
            ) : null}
            <Item label={t("serviceAccounts.status")}>
              {t(STATUS_KEY[item.status])}
            </Item>
            <Item label={t("serviceAccounts.note")}>{orDash(item.note)}</Item>
          </dl>
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
          <LoadError onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toServiceAccountHistory(history.data ?? [])} />
        )}
      </TabPanel>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="data-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
