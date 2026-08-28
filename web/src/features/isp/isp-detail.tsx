import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate, orDash } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { DatePicker } from "@/ui/date-picker";
import { Dialog } from "@/ui/dialog";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DetailHeader, Stat, StatGrid, StatIfSet } from "@/ui/detail-header";
import { Field } from "@/ui/page-header";
import { WarrantyTimeline } from "@/ui/warranty-timeline";
import { TabPanel, Tabs } from "@/ui/tabs";
import { VaultPanel } from "@/ui/vault-panel";
import { useToast } from "@/ui/toast";
import type { CatalogLists } from "@/features/catalog/catalog-types";
import { IspForm } from "./isp-form";
import { toIspHistory } from "./isp-history-entries";
import {
  STATUS_KEY,
  STATUS_TONE,
  type IspHistoryRow,
  type IspRow,
} from "./isp-types";
import { PATHS } from "@/lib/routes";

/**
 * Trang chi tiết đường truyền (story 3.3).
 * Tab Giấy tờ dùng lại `AttachmentPanel` chung — file scan hợp đồng gắn thẳng vào đường này.
 */
export function IspDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [tab, setTab] = useState("profile");
  const [editing, setEditing] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const line = useQuery({
    queryKey: ["isp", id],
    queryFn: () => apiFetch<IspRow>(`/api/v1/isp-lines/${id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ["isp", id, "history"],
    queryFn: () => apiFetch<IspHistoryRow[]>(`/api/v1/isp-lines/${id}/history`),
    enabled: tab === "history",
  });

  const lists = useQuery({
    queryKey: ["catalog", "lists"],
    queryFn: () =>
      apiFetch<CatalogLists>("/api/v1/catalog?includeInactive=true"),
    enabled: editing,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["isp"] });

  if (line.isLoading) return <Loading />;
  if (line.isError) {
    return line.error instanceof ApiError && line.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError onRetry={() => void line.refetch()} />
    );
  }

  const item = line.data!;

  return (
    <>
      <DetailHeader
        crumbs={[
          { label: t("nav.isp"), to: PATHS.ispLines },
          { label: item.provider },
          { label: item.code },
        ]}
        code={item.code}
        name={item.provider}
        copyLabel={t("isp.copyCode")}
        subline={
          <>
            {item.bandwidth ? <span>{item.bandwidth}</span> : null}
            {item.siteCode ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.siteCode}</span>
              </>
            ) : null}
            {item.wanIp ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t("isp.wanIp")} <span className="mono">{item.wanIp}</span>
                  <CopyButton value={item.wanIp} label={t("isp.copyWanIp")} />
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setEditing(true)}
            >
              {t("isp.edit")}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => setRenewing(true)}
            >
              {t("isp.renew")}
            </button>
          </>
        }
      />

      {/* HOTLINE đứng ô ĐẦU TIÊN, và là một link bấm gọi được.
          Đây là trang mở ra lúc 2 giờ sáng khi đứt cáp — thứ cần đầu tiên là số điện thoại,
          không phải mã hợp đồng. */}
      <StatGrid>
        <Stat label={t("isp.hotline")} note={item.provider}>
          {item.hotline ? (
            <a className="mono" href={`tel:${item.hotline.replace(/\s/g, "")}`}>
              {item.hotline}
            </a>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label={t("isp.status")}>
          <span className={`badge ${STATUS_TONE[item.status]}`}>
            {t(STATUS_KEY[item.status])}
          </span>
        </Stat>
        {/* Thanh hợp đồng đầy đủ nằm ở tab Hồ sơ — thẻ này chỉ còn ý nghĩa khi chưa khai hạn. */}
        {item.endDate ? null : (
          <Stat label={t("isp.contract")}>
            <ExpiryBadge end={null} />
          </Stat>
        )}
        <StatIfSet label={t("isp.contractNo")} value={item.contractNo} />
        <StatIfSet label={t("isp.bandwidth")} value={item.bandwidth} />
      </StatGrid>

      <Tabs
        items={[
          { key: "profile", label: t("isp.tabProfile") },
          /*
            Két sắt cho đường truyền (0036).
            Mật khẩu PPPoE và tài khoản quản trị modem nhà mạng trước đây không có chỗ đứng —
            `file.owner_type` đã nhận `isp` từ lâu mà `secret.owner_type` thì chưa, nên hợp
            đồng PDF đính vào được còn mật khẩu thì chảy vào ô Ghi chú, chỗ không mã hóa.
          */
          { key: "vault", label: t("vault.tab") },
          { key: "attachments", label: t("isp.tabAttachments") },
          { key: "history", label: t("isp.tabHistory") },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("isp.title")}
      />

      <TabPanel tabKey={tab}>
        {tab === "profile" ? (
          <>
            {/* Thanh hợp đồng ĐẦY ĐỦ — hai ô ngày rời nhau bắt người đọc tự trừ trong đầu. */}
            {item.endDate ? (
              <section className="card">
                <h2 className="form-section-title">{t("isp.contract")}</h2>
                <WarrantyTimeline
                  start={item.startDate}
                  end={item.endDate}
                  startLabel={t("isp.startDate")}
                  endLabel={t("isp.endDate")}
                />
              </section>
            ) : null}

            {/* Nhà mạng · băng thông · IP tĩnh ĐÃ ở dòng định danh; hotline · trạng thái ·
                hợp đồng · số hợp đồng ĐÃ ở dải chỉ số. Lưới chỉ còn phần chưa nói. */}
            <dl className="data-grid">
              <Item label={t("isp.site")}>{orDash(item.siteCode)}</Item>
              <Item label={t("isp.device")}>
                {item.deviceId ? (
                  <Link className="mono" to={PATHS.device(item.deviceId)}>
                    {item.deviceCode}
                  </Link>
                ) : (
                  "—"
                )}
              </Item>
              <Item label={t("isp.note")}>{orDash(item.note)}</Item>
            </dl>
            <BlankFields
              labels={[
                item.bandwidth ? null : t("isp.bandwidth"),
                item.wanIp ? null : t("isp.wanIp"),
                item.hotline ? null : t("isp.hotline"),
                item.siteCode ? null : t("isp.site"),
                item.deviceId ? null : t("isp.device"),
                item.note ? null : t("isp.note"),
              ].filter((label): label is string => label !== null)}
            />
          </>
        ) : tab === "vault" ? (
          <VaultPanel
            ownerType="isp"
            ownerId={item.id}
            me={me}
            /* Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
            canEdit={me.role === "sa" || me.role === "admin"}
          />
        ) : tab === "attachments" ? (
          <AttachmentPanel
            ownerType="isp"
            ownerId={item.id}
            csrfToken={me.csrfToken}
          />
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toIspHistory(history.data ?? [])} />
        )}
      </TabPanel>

      {editing ? (
        <IspForm
          row={item}
          lists={lists.data}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      ) : null}

      {renewing ? (
        <RenewDialog
          line={item}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(false)}
          onDone={() => {
            setRenewing(false);
            toast({ message: t("isp.renewed") });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function RenewDialog({
  line,
  csrfToken,
  onClose,
  onDone,
}: {
  line: IspRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const renew = useApiMutation<{ endDate: string }, unknown>(
    `/api/v1/isp-lines/${line.id}/renew`,
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      title={`${t("isp.renew")} — ${line.code}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="isp-renew-form"
            className="btn primary"
            disabled={renew.isPending}
          >
            {renew.isPending ? t("common.loading") : t("isp.renew")}
          </button>
        </>
      }
    >
      <form
        id="isp-renew-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!endDate) {
            setError(t("isp.endDate"));
            return;
          }
          renew.mutate(
            { endDate },
            {
              onSuccess: onDone,
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <p className="muted">
          {t("isp.endDate")}: {line.endDate ? formatDate(line.endDate) : "—"}
        </p>
        <Field label={t("isp.endDate")} required>
          <DatePicker
            value={endDate}
            ariaLabel={t("isp.renew")}
            /* Hạn mới phải sau hạn cũ — chặn trên lịch cho đỡ bấm nhầm; API vẫn kiểm lại. */
            min={line.endDate ?? undefined}
            onChange={setEndDate}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
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
