import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate, orDash } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { DatePicker } from "@/ui/date-picker";
import { Dialog } from "@/ui/dialog";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { Field } from "@/ui/page-header";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { PageHeader } from "@/ui/page-header";
import { TabPanel, Tabs, initialTab, useVisibleTab } from "@/ui/tabs";
import { VaultPanel } from "@/ui/vault-panel";
import { useToast } from "@/ui/toast";
import type { CatalogLists } from "@/features/catalog/catalog-types";
import { LicenseAssignmentsPanel } from "./license-assignments-panel";
import { SoftwareForm } from "./software-form";
import { toSoftwareHistory } from "./software-history-entries";
import {
  KIND_KEY,
  STATUS_KEY,
  STATUS_TONE,
  seatLabel,
  supportsSeats,
  type SoftwareHistoryRow,
  type SoftwareRow,
} from "./software-types";
import { PATHS } from "@/lib/routes";

/**
 * Trang chi tiết hồ sơ phần mềm (story 3.1).
 *
 * Tab "Máy đang dùng" ra đời ở story 3.2; khung tab dựng sẵn để lúc đó chỉ cắm thêm.
 * Khối "Chìa khóa / mật khẩu" cố tình để TRỐNG với một câu giải thích: key nằm ở Két sắt
 * (Epic 4), không nằm trong bảng này (AC 3.1) — nói rõ còn hơn để người dùng đi tìm.
 */
export function SoftwareDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() =>
    initialTab(params.get("tab"), [
      "profile",
      "devices",
      "vault",
      "attachments",
      "history",
    ]),
  );
  const [editing, setEditing] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const software = useQuery({
    queryKey: ["software", id],
    queryFn: () => apiFetch<SoftwareRow>(`/api/v1/software/${id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ["software", id, "history"],
    queryFn: () =>
      apiFetch<SoftwareHistoryRow[]>(`/api/v1/software/${id}/history`),
    enabled: tab === "history",
  });

  const lists = useQuery({
    queryKey: ["catalog", "lists"],
    queryFn: () =>
      apiFetch<CatalogLists>("/api/v1/catalog?includeInactive=true"),
    enabled: editing,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["software"] });

  /**
   * Tab Két sắt hiện cho MỌI vai kể từ story 6.3.
   *
   * Trước đây chỉ SA/Admin thấy. Nhưng Member giờ có thể được whitelist hoặc xin duyệt, và
   * quyền đó nằm ở ma trận 6.2 — client không tự suy ra được từ vai. Ẩn tab theo vai thì
   * người đã được gán quyền lại không có đường nào tới. Panel tự nói rõ tầng của người xem.
   */
  const canVault = true;

  /*
   * Danh sách tab dựng TRƯỚC mấy nhánh `return` sớm bên dưới, vì `useVisibleTab` là hook:
   * đặt nó sau `if (software.isLoading) return` thì số hook giữa hai lượt render lệch nhau.
   */
  const tabItems = [
    { key: "profile", label: t("software.tabProfile") },
    // Tab "Máy đang dùng" chỉ có nghĩa với license (story 3.2).
    ...(software.data && supportsSeats(software.data.kind)
      ? [
          {
            key: "devices",
            label: t("software.tabDevices"),
            count: software.data.seatUsed,
          },
        ]
      : []),
    // Két sắt chỉ hiện với người có quyền — Member không có đường tới endpoint (AD-9).
    ...(canVault ? [{ key: "vault", label: t("vault.tab") }] : []),
    // Hợp đồng license, thư xác nhận SSL, hóa đơn tên miền — cùng `AttachmentPanel` với
    // thiết bị (2.3) và đường truyền (3.3), không có bản riêng cho phần mềm.
    { key: "attachments", label: t("software.tabAttachments") },
    { key: "history", label: t("software.tabHistory") },
  ];
  const safeTab = useVisibleTab(
    tab,
    tabItems.map((entry) => entry.key),
    setTab,
  );

  if (software.isLoading) return <Loading />;
  if (software.isError) {
    return software.error instanceof ApiError &&
      software.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError onRetry={() => void software.refetch()} />
    );
  }

  const item = software.data!;
  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày ra nút để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";

  return (
    <>
      <PageHeader
        title={`${item.code} — ${item.name}`}
        subtitle={`${t(KIND_KEY[item.kind])}${item.vendorName ? ` · ${item.vendorName}` : ""}`}
        actions={
          <>
            <Link className="btn" to={PATHS.software}>
              {t("software.back")}
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => setEditing(true)}
            >
              {t("software.edit")}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => setRenewing(true)}
            >
              {t("software.renew")}
            </button>
          </>
        }
      />

      <div className="device-summary">
        <span className={`badge ${STATUS_TONE[item.status]}`}>
          {t(STATUS_KEY[item.status])}
        </span>
        {item.licenseModel === "perpetual" ? (
          <span className="badge ok plain">{t("software.perpetual")}</span>
        ) : (
          <ExpiryBadge end={item.endDate} />
        )}
        {supportsSeats(item.kind) && item.seatTotal !== null ? (
          <span className="muted">
            {t("software.seats")}:{" "}
            <span className="mono">{seatLabel(item)}</span>
          </span>
        ) : null}
      </div>

      <Tabs
        items={tabItems}
        value={safeTab}
        onChange={setTab}
        ariaLabel={t("software.title")}
      />

      <TabPanel tabKey={safeTab}>
        {safeTab === "profile" ? (
          <>
            <dl className="data-grid">
              <Item label={t("software.kind")}>{t(KIND_KEY[item.kind])}</Item>
              <Item label={t("software.vendor")}>
                {orDash(item.vendorName)}
              </Item>
              <Item label={t("software.seats")}>{seatLabel(item)}</Item>
              <Item label={t("software.startDate")}>
                {orDash(formatDate(item.startDate))}
              </Item>
              <Item label={t("software.licenseModel")}>
                {supportsSeats(item.kind)
                  ? t(
                      item.licenseModel === "perpetual"
                        ? "software.perpetual"
                        : "software.subscription",
                    )
                  : "—"}
              </Item>
              <Item label={t("software.endDate")}>
                {item.licenseModel === "perpetual" ? (
                  t("software.perpetual")
                ) : item.endDate ? (
                  <>
                    {formatDate(item.endDate)}{" "}
                    <ExpiryBadge end={item.endDate} />
                  </>
                ) : (
                  "—"
                )}
              </Item>
              <Item label={t("software.status")}>
                {t(STATUS_KEY[item.status])}
              </Item>
              <Item label={t("software.note")}>{orDash(item.note)}</Item>
            </dl>
          </>
        ) : safeTab === "vault" ? (
          <VaultPanel
            ownerType="software"
            ownerId={item.id}
            me={me}
            canEdit={canVaultWrite}
          />
        ) : safeTab === "devices" ? (
          <LicenseAssignmentsPanel software={item} csrfToken={me.csrfToken} />
        ) : safeTab === "attachments" ? (
          <AttachmentPanel
            ownerType="software"
            ownerId={item.id}
            csrfToken={me.csrfToken}
          />
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toSoftwareHistory(history.data ?? [])} />
        )}
      </TabPanel>

      {editing ? (
        <SoftwareForm
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
          software={item}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(false)}
          onDone={() => {
            setRenewing(false);
            toast({ message: t("software.renewed") });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function RenewDialog({
  software,
  csrfToken,
  onClose,
  onDone,
}: {
  software: SoftwareRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const renew = useApiMutation<{ endDate: string }, unknown>(
    `/api/v1/software/${software.id}/renew`,
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      title={`${t("software.renewTitle")} — ${software.code}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="renew-form"
            className="btn primary"
            disabled={renew.isPending}
          >
            {renew.isPending ? t("common.loading") : t("software.renew")}
          </button>
        </>
      }
    >
      <form
        id="renew-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!endDate) {
            setError(t("software.renewHint"));
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
          {t("software.endDate")}:{" "}
          {software.endDate ? formatDate(software.endDate) : "—"}
        </p>
        <Field
          label={t("software.endDate")}
          required
          hint={t("software.renewHint")}
        >
          <DatePicker
            value={endDate}
            ariaLabel={t("software.renewTitle")}
            /* Hạn mới phải sau hạn cũ — chặn ngay trên lịch cho khỏi bấm nhầm;
               API vẫn kiểm lại vì chốt chặn thật phải nằm ở server. */
            min={software.endDate ?? undefined}
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
