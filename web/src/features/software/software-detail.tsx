import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { DatePicker } from "@/ui/date-picker";
import { Dialog } from "@/ui/dialog";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { Field } from "@/ui/page-header";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { DisposeButton } from "@/ui/dispose-button";
import { WarrantyTimeline } from "@/ui/warranty-timeline";
import { TabPanel, Tabs, initialTab, useVisibleTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { useToast } from "@/ui/toast";
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
  const counts = useTabCounts("software", id, me);
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
    ...(canVault
      ? [{ key: "vault", label: t("vault.tab"), count: counts.secrets }]
      : []),
    // Hợp đồng license, thư xác nhận SSL, hóa đơn tên miền — cùng `AttachmentPanel` với
    // thiết bị (2.3) và đường truyền (3.3), không có bản riêng cho phần mềm.
    {
      key: "attachments",
      label: t("software.tabAttachments"),
      count: counts.files,
    },
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
      <LoadError error={software.error} onRetry={() => void software.refetch()} />
    );
  }

  const item = software.data!;
  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày ra nút để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";

  return (
    <>
      <DetailHeader
        crumbs={[
          { label: t("nav.software"), to: PATHS.software },
          { label: t(KIND_KEY[item.kind]) },
          { label: item.code },
        ]}
        code={item.code}
        name={item.name}
        subline={
          <>
            <span>{t(KIND_KEY[item.kind])}</span>
            {item.vendorName ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.vendorName}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {/* "Sửa hồ sơ" là việc chính của màn nên nó mang trọng số primary; "Gia hạn" lùi
                về nút thường. Trước 16/09 hai cái ngược nhau. */}
            <button
              type="button"
              className="btn primary"
              onClick={() => setEditing(true)}
            >
              {t("software.edit")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setRenewing(true)}
            >
              {t("software.renew")}
            </button>
            {item.status !== "retired" ? (
              <DisposeButton
                url={`/api/v1/software/${item.id}`}
                body={{ status: "retired" }}
                label={t("disposal.dispose")}
                confirmMessage={t("disposal.confirmSoftware", { code: item.code })}
                csrfToken={me.csrfToken}
                onDone={() => void refresh()}
              />
            ) : null}
          </>
        }
      />

      <DetailLayout
        rail={
          <RailCard title={t("detail.identityCard")}>
            <RailRow
              label={t("software.status")}
              note={
                item.startDate
                  ? `${t("expiry.from")} ${formatDate(item.startDate)}`
                  : undefined
              }
            >
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </RailRow>

            {/*
             * HẠN NẰM Ở ĐÂY, KHÔNG CÒN THẺ THỨ HAI Ở CỘT CHÍNH (16/09/2026).
             *
             * Trước đây tab Hồ sơ vẽ một thẻ "Hết hạn" chiếm trọn bề ngang, còn dải chỉ số vẽ
             * lại chính nó ở dạng gọn cách đó hai dòng. License vĩnh viễn thì không có quãng
             * đường nào để vẽ nên vẫn chỉ là một huy hiệu.
             */}
            <RailRow label={t("software.endDate")}>
              {item.licenseModel === "perpetual" ? (
                <span className="badge ok plain">{t("software.perpetual")}</span>
              ) : item.endDate ? (
                <WarrantyTimeline
                  start={item.startDate}
                  end={item.endDate}
                  startLabel={t("software.startDate")}
                  endLabel={t("software.endDate")}
                />
              ) : (
                <ExpiryBadge end={null} />
              )}
            </RailRow>

            {/* Ghế đã dùng là con số quyết định "có phải mua thêm không" — nó thuộc về thẻ
                định danh, không phải nằm sâu trong một tab. */}
            {supportsSeats(item.kind) ? (
              <RailRow label={t("software.seats")} note={t("software.seatsNote")}>
                <span className="mono">{seatLabel(item)}</span>
              </RailRow>
            ) : null}

            <RailRowIfSet label={t("software.vendor")} value={item.vendorName} />
          </RailCard>
        }
      >
        <Tabs
          items={tabItems}
          value={safeTab}
          onChange={setTab}
          ariaLabel={t("software.title")}
        />

        <TabPanel tabKey={safeTab}>
        {safeTab === "profile" ? (
          <>
            {/* Loại · nhà cung cấp ĐÃ ở dòng định danh; trạng thái · hạn · ghế ĐÃ ở thẻ định
                danh bên phải. Lưới chỉ còn phần chưa nói ở đâu cả. Ngày bắt đầu cũng bỏ: nó là
                mốc đầu của chính thanh hạn bên phải. */}
            <dl className="data-grid">
              <Item label={t("software.licenseModel")}>
                {supportsSeats(item.kind)
                  ? t(
                      item.licenseModel === "perpetual"
                        ? "software.perpetual"
                        : "software.subscription",
                    )
                  : "—"}
              </Item>
              <DataItemIfSet label={t("software.note")} value={item.note} />
            </dl>
            <BlankFields
              labels={[
                item.vendorName ? null : t("software.vendor"),
                item.startDate ? null : t("software.startDate"),
                item.note ? null : t("software.note"),
              ].filter((label): label is string => label !== null)}
            />
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
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toSoftwareHistory(history.data ?? [], t)} />
        )}
        </TabPanel>
      </DetailLayout>

      {editing ? (
        <SoftwareForm
          row={item}
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!renew.isPending}
      guardUnsaved
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
            /* Bản cũ đặt chính câu HINT đang hiện xám ngay trên ô làm câu lỗi: khối đỏ và
               dòng xám nói y hệt nhau, nên người dùng đọc xong vẫn không biết phải sửa gì. */
            setError(t("expiry.pickDate"));
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
