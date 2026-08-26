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
import { Field, PageHeader } from "@/ui/page-header";
import { TabPanel, Tabs } from "@/ui/tabs";
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
      <PageHeader
        title={`${item.code} — ${item.provider}`}
        subtitle={[item.bandwidth, item.siteCode].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link className="btn" to={PATHS.ispLines}>
              {t("isp.back")}
            </Link>
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

      {/* Dải tóm tắt đặt hotline lên đầu: mở trang này lúc mất mạng là để gọi nhà mạng. */}
      <div className="device-summary">
        <span className={`badge ${STATUS_TONE[item.status]}`}>
          {t(STATUS_KEY[item.status])}
        </span>
        <ExpiryBadge end={item.endDate} />
        {item.hotline ? (
          <span>
            {t("isp.hotline")}:{" "}
            <a className="mono" href={`tel:${item.hotline.replace(/\s/g, "")}`}>
              {item.hotline}
            </a>
          </span>
        ) : null}
        {item.contractNo ? (
          <span className="muted">
            {t("isp.contractNo")}:{" "}
            <span className="mono">{item.contractNo}</span>
          </span>
        ) : null}
      </div>

      <Tabs
        items={[
          { key: "profile", label: t("isp.tabProfile") },
          { key: "attachments", label: t("isp.tabAttachments") },
          { key: "history", label: t("isp.tabHistory") },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("isp.title")}
      />

      <TabPanel tabKey={tab}>
        {tab === "profile" ? (
          <dl className="data-grid">
            <Item label={t("isp.provider")}>{item.provider}</Item>
            <Item label={t("isp.bandwidth")}>{orDash(item.bandwidth)}</Item>
            <Item label={t("isp.wanIp")}>
              <span className="mono">{orDash(item.wanIp)}</span>
            </Item>
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
            <Item label={t("isp.hotline")}>
              <span className="mono">{orDash(item.hotline)}</span>
            </Item>
            <Item label={t("isp.contractNo")}>
              <span className="mono">{orDash(item.contractNo)}</span>
            </Item>
            <Item label={t("isp.startDate")}>
              {orDash(formatDate(item.startDate))}
            </Item>
            <Item label={t("isp.endDate")}>
              {item.endDate ? (
                <>
                  {formatDate(item.endDate)} <ExpiryBadge end={item.endDate} />
                </>
              ) : (
                "—"
              )}
            </Item>
            <Item label={t("isp.note")}>{orDash(item.note)}</Item>
          </dl>
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
