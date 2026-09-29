import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { HistoryPanel } from "@/ui/history-panel";
import { AuditLogLink } from "@/ui/audit-log-link";
import { DetailLoadFailed, LoadError, Loading } from "@/ui/load-state";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  DetailSection,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { useDispose } from "@/ui/dispose-button";
import { RenewDialog } from "@/ui/renew-dialog";
import { RowActions } from "@/ui/row-actions";
import { useCatalogLists } from "@/ui/use-catalog-lists";
import { WarrantyTimeline } from "@/ui/warranty-timeline";
import { TabPanel, Tabs, initialTab, useVisibleTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { useToast } from "@/ui/toast";
import { LicenseAssignmentsPanel } from "./license-assignments-panel";
import type { SeatRow } from "./seat-table";
import { SoftwareForm } from "./software-form";
import { SoftwareRenewals } from "./software-renewals";
import { softwareHistoryGroup, toSoftwareHistory } from "./software-history-entries";
import {
  KIND_KEY,
  STATUS_KEY,
  STATUS_TONE,
  supportsSeats,
  supportsWebsites,
  type SoftwareDetailRow,
  type SoftwareHistoryRow,
  type SoftwareKind,
  type SoftwareRow,
} from "./software-types";
import { activeSeatCodes, softwareDisposeMessage } from "./software-dispose-message";
import { RestoreDialog } from "./software-restore-dialog";
import { retiredAfterDays, standingOf } from "./software-standing";
import { SeatUsage } from "./software-standing-cell";
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
  /* `null` = người dùng chưa chọn tab nào: tab mặc định đi theo LOẠI hồ sơ (xem `defaultTab`),
     mà loại chỉ biết khi hồ sơ đã về. `?tab=` trên URL thì luôn thắng. */
  const [chosenTab, setTab] = useState<string | null>(() =>
    params.get("tab")
      ? initialTab(params.get("tab"), [
          "profile",
          "devices",
          "vault",
          "attachments",
          "history",
        ])
      : null,
  );
  const [editing, setEditing] = useState(false);
  const [renewing, setRenewing] = useState(false);
  // `?restore=1` (lối tắt "Khôi phục…" từ Kho thanh lý) mở thẳng hộp Khôi phục.
  const [restoring, setRestoring] = useState(() => params.get("restore") === "1");
  const [historyGroup, setHistoryGroup] = useState<"" | "renew" | "seat" | "profile">("");
  const lists = useCatalogLists();

  const software = useQuery({
    queryKey: ["software", id],
    queryFn: () => apiFetch<SoftwareDetailRow>(`/api/v1/software/${id}`),
    retry: false,
  });

  const tab = chosenTab ?? defaultTab(software.data?.kind);

  const history = useQuery({
    queryKey: ["software", id, "history"],
    queryFn: () =>
      apiFetch<SoftwareHistoryRow[]>(`/api/v1/software/${id}/history`),
    enabled: tab === "history",
  });

  /* Cùng khoá cache với tab Máy đang dùng (`LicenseAssignmentsPanel`): mở hộp Gia hạn sau khi
     đã xem tab đó thì không tải lại. Chỉ hỏi khi hộp mở — ghế là việc của license. */
  const seatRows = useQuery({
    queryKey: ["software", id, "assignments", true],
    queryFn: () =>
      apiFetch<SeatRow[]>(`/api/v1/software/${id}/assignments?includeReleased=true`),
    enabled: renewing && software.data?.kind === "license",
  });
  const seatEnds = (seatRows.data ?? [])
    .filter((seat) => !seat.releasedAt && seat.endDate)
    .map((seat) => seat.endDate as string);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["software"] });
  const vendorName = (vendorId: string) =>
    lists.data?.vendors.find((vendor) => vendor.id === vendorId)?.name;

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
    /*
     * Tab "Máy đang dùng" chỉ có nghĩa với license (story 3.2) — NHƯNG khi hồ sơ chưa về thì
     * chưa biết nó là loại gì, và "chưa biết" không được xử như "không phải license".
     *
     * `useVisibleTab` kẹp `tab` về `'profile'` ngay ở lượt render đầu nếu khoá hiện tại không
     * có trong danh sách này. Mở thẳng `/software/<id>?tab=devices` (hoặc F5 khi đang đứng ở
     * đó) thì `software.data` còn `undefined` → tab chưa mọc → bị kẹp → dữ liệu về, tab mọc
     * lại, nhưng `tab` đã là `'profile'`. Cùng một lỗi với `?tab=ports` bên trang thiết bị.
     */
    ...(software.isPending || (software.data && supportsSeats(software.data.kind))
      ? [
          {
            key: "devices",
            label: t("software.tabDevices"),
            count: software.data?.seatUsed,
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
    // Giữ đường lùi về danh sách, và tách "hồ sơ không còn" (404) khỏi "máy chủ lỗi".
    return (
      <DetailLoadFailed
        error={software.error}
        onRetry={() => void software.refetch()}
        backTo={PATHS.software}
        backLabel={t("nav.software")}
      />
    );
  }

  // Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined:
  // hai nhánh trên đều trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx` (lỗi F-02).
  if (!software.data) return <Loading />;
  const item = software.data;
  const retired = item.status === "retired";
  const standing = standingOf(item);
  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày ra nút để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";

  return (
    <>
      <DetailHeader
        crumbs={[
          { label: t("nav.software"), to: PATHS.software },
          // Mắt xích loại dẫn về danh sách đã lọc đúng loại này.
          { label: t(KIND_KEY[item.kind]), to: `${PATHS.software}?kind=${item.kind}` },
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
            {/* Gia hạn không dùng cho hồ sơ Thanh lý (Q-13: hồi sinh phải là một thao tác Sửa
                có chủ ý) và vô nghĩa với license vĩnh viễn — API từ chối cả hai. Hồ sơ Thanh lý
                thì chỗ này là "Khôi phục…". */}
            {retired ? (
              <button type="button" className="btn" onClick={() => setRestoring(true)}>
                {t("software.restore")}
              </button>
            ) : item.licenseModel !== "perpetual" ? (
              <button
                type="button"
                className="btn"
                onClick={() => setRenewing(true)}
              >
                {t("software.renew")}
              </button>
            ) : null}
            {/* Thanh lý vào menu "⋯", không đứng lẻ một nút đỏ ở mép phải: header chỉ giữ hai
                nút cùng cỡ, và mục nguy hiểm nằm cuối menu như mọi chỗ khác (RowActions). */}
            {!retired ? (
              <DetailMoreActions item={item} csrfToken={me.csrfToken} onDone={() => void refresh()} />
            ) : null}
          </>
        }
      />

      {standing.kind === "expired" && standing.retireInDays !== null && item.autoRetireOn ? (
        /* Q-13: hồ sơ Hết hạn sẽ tự Thanh lý và gỡ mọi ghế — nói trước NGÀY và SỐ MÁY, kèm nút
           cứu ngay tại đây, đừng để người dùng phát hiện khi hồ sơ đã vào kho. */
        <div className="alert warn" role="status">
          <strong>
            {t("software.autoRetireWarn", {
              count: standing.retireInDays,
              date: formatDate(item.autoRetireOn),
            })}
          </strong>{" "}
          {item.seatUsed > 0 ? (
            <span>{t("software.autoRetireSeats", { count: item.seatUsed })}</span>
          ) : null}{" "}
          {item.licenseModel !== "perpetual" && item.endDate ? (
            <button type="button" className="btn sm" onClick={() => setRenewing(true)}>
              {t("software.renew")}
            </button>
          ) : null}
        </div>
      ) : null}

      {retired ? (
        <div className="alert" role="status">
          <strong>{retiredLine(item, t)}</strong>{" "}
          <span>{t("software.retiredNote")}</span>{" "}
          <button type="button" className="btn sm" onClick={() => setRestoring(true)}>
            {t("software.restore")}
          </button>
        </div>
      ) : null}

      <DetailLayout
        rail={
          <>
          <RailCard title={t("detail.identityCard")}>
            {/* Không kèm ngày dưới trạng thái: ngày bắt đầu đọc thành "Hết hạn từ ngày…" —
                sai nghĩa. Ngày bắt đầu đã là mốc đầu của thanh thời hạn ngay dưới. */}
            <RailRow label={t("software.status")}>
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
                <span className="badge outline plain">∞ {t("software.perpetual")}</span>
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
              <RailRow label={t("software.seats")}>
                <SeatUsage item={item} />
              </RailRow>
            ) : null}

            <RailRowIfSet label={t("software.vendor")} value={item.vendorName} />
          </RailCard>
          {/* Website nằm ở cột phải, không trong tab Hồ sơ: SSL mở sẵn tab Giấy tờ, mà "cert
              này đang phủ website nào" là câu người trực sự cố hỏi đầu tiên (Q-15, SW-043). */}
          {supportsWebsites(item.kind) ? (
            <RailCard
              title={t(item.kind === "ssl" ? "software.websitesSsl" : "software.websitesDomain")}
            >
              {(item.websites ?? []).length > 0 ? (
                <ul className="chip-row">
                  {(item.websites ?? []).map((site) => (
                    <li key={site} className="chip mono">
                      {site}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{t("software.websitesEmpty")}</p>
              )}
            </RailCard>
          ) : null}
          </>
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
            {/* Khu "Hồ sơ" có thẻ + tiêu đề như mọi khu khác — xem chú thích dài ở
                `ui/detail-layout.tsx`, chỗ khai `DetailSection`. KHÔNG `compact`: khu này đứng
                một mình trong cột chính, thứ để mắt so là thẻ định danh bên phải. */}
            <DetailSection title={t("detail.profileSection")}>
              <dl className="data-grid">
              {/* KHÔNG vẽ ô chỉ để chứa một dấu gạch ngang (`_SPEC.md:53`, gạch nghiệm thu
                  `:528`): với SSL và tên miền thì "Kỳ hạn" không có nghĩa, nên ô ấy trước đây
                  được vẽ ra chỉ để đựng "—". Lưới CHỈ vẽ ô có giá trị; dòng "Chưa khai" bên
                  dưới là nơi DUY NHẤT nói về ô trống. Bốn màn chi tiết kia đã theo luật này,
                  riêng chỗ này còn dùng `Item` trần. */}
              {supportsSeats(item.kind) ? (
                <Item label={t("software.licenseModel")}>
                  {t(
                    item.licenseModel === "perpetual"
                      ? "software.perpetual"
                      : "software.subscription",
                  )}
                </Item>
              ) : null}
                <DataItemIfSet label={t("software.note")} value={item.note} />
              </dl>
              <BlankFields
                labels={[
                  item.vendorName ? null : t("software.vendor"),
                  item.startDate ? null : t("software.startDate"),
                  item.note ? null : t("software.note"),
                ].filter((label): label is string => label !== null)}
              />
            </DetailSection>
          </>
        ) : safeTab === "vault" ? (
          <VaultPanel
            ownerType="software"
            ownerId={item.id}
            ownerLabel={item.code}
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
          <>
            {/* Chip lọc: license nhiều ghế có hàng chục dòng gán/gỡ, dòng gia hạn chìm giữa. */}
            <div
              className="segmented history-filter"
              role="group"
              aria-label={t("software.historyFilter")}
            >
              {(["", "renew", "seat", "profile"] as const).map((group) => (
                <button
                  key={group || "all"}
                  type="button"
                  aria-pressed={historyGroup === group}
                  onClick={() => setHistoryGroup(group)}
                >
                  {t(HISTORY_GROUP_KEY[group])}
                </button>
              ))}
            </div>
            <AuditLogLink role={me.role} objectType="software" objectId={item.id} />
            {historyGroup === "renew" ? (
              <SoftwareRenewals softwareId={item.id} withWebsites={supportsWebsites(item.kind)} />
            ) : null}
            <HistoryPanel
              entries={toSoftwareHistory(
                (history.data ?? []).filter(
                  (row) => !historyGroup || softwareHistoryGroup(row.action) === historyGroup,
                ),
                t,
                vendorName,
              )}
            />
          </>
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

      {restoring && retired ? (
        <RestoreDialog
          software={item}
          csrfToken={me.csrfToken}
          onClose={() => setRestoring(false)}
          onDone={({ assigned, failures }) => {
            setRestoring(false);
            toast({ message: t("software.restored") });
            if (assigned > 0) {
              toast({ message: t("software.restoredAssigned", { count: assigned }) });
            }
            for (const failure of failures) toast({ message: failure, tone: "warn" });
            void refresh();
          }}
        />
      ) : null}

      {renewing && item.endDate ? (
        <RenewDialog
          row={{ kind: item.kind, id: item.id, code: item.code, label: item.name, end: item.endDate }}
          kindLabel={t(KIND_KEY[item.kind])}
          url={`/api/v1/software/${item.id}/renew`}
          withTerms
          seatEnds={seatEnds}
          websites={supportsWebsites(item.kind) ? (item.websites ?? []) : undefined}
          attachTo={{ ownerType: "software", ownerId: item.id }}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(false)}
          onDone={() => {
            setRenewing(false);
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

const HISTORY_GROUP_KEY = {
  "": "software.historyAll",
  renew: "software.historyRenew",
  seat: "software.historySeat",
  profile: "software.historyProfile",
} as const;

/**
 * Tab mở sẵn theo loại: license thì "Máy đang dùng" (thứ người ta mở hồ sơ để xem), SSL và tên
 * miền thì "Giấy tờ" — tab Hồ sơ của chúng gần như trống vì mọi thứ đã nằm ở thẻ bên phải.
 */
function defaultTab(kind: SoftwareKind | undefined): string {
  if (kind && supportsSeats(kind)) return "devices";
  if (kind === "ssl" || kind === "domain") return "attachments";
  return "profile";
}

/**
 * Menu "⋯" ở đầu trang chi tiết — hiện chỉ có Thanh lý. Component riêng vì `useDispose` là
 * hook, mà trang có mấy nhánh `return` sớm trước chỗ vẽ header.
 */
function DetailMoreActions({
  item,
  csrfToken,
  onDone,
}: {
  item: SoftwareRow;
  csrfToken: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dispose = useDispose({
    url: `/api/v1/software/${item.id}`,
    body: { status: "retired" },
    label: t("disposal.dispose"),
    confirmMessage: softwareDisposeMessage(t, item.code, item.seatUsed, null),
    resolveMessage:
      item.seatUsed > 0
        ? async () =>
            softwareDisposeMessage(t, item.code, item.seatUsed, await activeSeatCodes(item.id))
        : undefined,
    csrfToken,
    onDone,
  });
  return (
    <RowActions
      label={t("common.actionsOf", { subject: item.code })}
      items={[
        {
          key: "dispose",
          label: t("disposal.dispose"),
          onSelect: dispose.run,
          danger: true,
          disabled: dispose.isPending,
        },
      ]}
    />
  );
}

/** Dòng đậm của băng Thanh lý: ngày nào, tự động hay do ai. */
function retiredLine(item: SoftwareDetailRow, t: TFunction): string {
  const info = item.retirement;
  if (!info) return t("software.retiredUnknown");
  const date = formatDate(info.at);
  if (!info.auto) return t("software.retiredBy", { date, by: info.by });
  const days = retiredAfterDays(item.endDate, new Date(info.at));
  return days === null
    ? t("software.retiredAutoNoDays", { date })
    : t("software.retiredAuto", { date, days });
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="data-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
