import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/api-client";
import { errorMessage } from "@/lib/api";
import { formatDateTime, orDash } from "@/lib/format";
import type { Me } from "@/lib/me";
import { OWNER_PATH, PATHS } from "@/lib/routes";
import {
  BREAK_GLASS_KEY,
  BreakGlassSentAgo,
  BreakGlassStateBadge,
  BreakGlassSubject,
  DecisionDialog,
  isStepUpCancelled,
  useBreakGlassActions,
  type BreakGlassRow,
} from "@/ui/break-glass";
import { DataTable } from "@/ui/data-table";
import { DatePicker } from "@/ui/date-picker";
import { ExportXlsxButton } from "@/ui/export-xlsx-button";
import { FilterBar } from "@/ui/filter-bar";
import { EmptyState, LoadError, Loading } from "@/ui/load-state";
import { PageHeader } from "@/ui/page-header";
import { Pagination } from "@/ui/pagination";
import { Select } from "@/ui/select";
import { TabPanel, Tabs } from "@/ui/tabs";
import { useConfirm } from "@/ui/confirm-provider";
import { BREAKPOINTS } from "@/ui/breakpoints";
import { useMediaQuery } from "@/ui/use-media-query";
import { useToast } from "@/ui/toast";

type ApprovalRow = BreakGlassRow;

/** Nhật ký và "của tôi" chỉ lớn lên theo thời gian — server cắt trang, màn này không tải cả kho. */
const PAGE_LIMIT = 20;

/**
 * Hàng chờ tự hỏi lại: người duyệt để tab mở rồi quay lại từ app Mail, hoặc hai người cùng
 * trực — không làm mới thì danh sách nói một đằng còn sổ đã một nẻo.
 */
const PENDING_REFETCH_MS = 30_000;

/** Trên điện thoại nút Xuất xuống cuối nhật ký, không chiếm một hàng giữa tiêu đề và thanh tab.
    Cùng mốc với thẻ gọn của bảng: lệch mốc thì ở 600–640px nút đã rời đầu trang trong khi bảng
    vẫn là bảng desktop. */
const NARROW_QUERY = BREAKPOINTS.cards;

interface ApprovalPage {
  items: ApprovalRow[];
  total: number;
}

/** Bộ lọc tab Nhật ký — tên khoá theo `LogQueryDto` bên API. */
export interface LogFilters {
  state: string;
  requester: string;
  from: string;
  to: string;
}

const EMPTY_LOG_FILTERS: LogFilters = { state: "", requester: "", from: "", to: "" };

/** Trạng thái lọc được — API đọc theo đồng hồ, "Đã duyệt" là còn hiệu lực. */
const LOG_STATES = ["pending", "approved", "expired", "revoked", "denied", "cancelled"] as const;
const LOG_STATE_KEY: Record<(typeof LOG_STATES)[number], string> = {
  pending: "approvals.statePending",
  approved: "approvals.stateApproved",
  expired: "approvals.stateExpired",
  revoked: "approvals.stateRevoked",
  denied: "approvals.stateDenied",
  cancelled: "approvals.stateCancelled",
};

/** Tham số bộ lọc gửi API — chung cho danh sách và file xuất, để file khớp đúng thứ đang xem. */
export function logFilterQuery(filters: LogFilters): string {
  const params = new URLSearchParams();
  if (filters.state) params.set("state", filters.state);
  if (filters.requester.trim()) params.set("requester", filters.requester.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

/** Ô người xin gửi đi sau khi ngừng gõ — mỗi phím một lượt quét sổ là phí. */
const REQUESTER_DEBOUNCE_MS = 300;

/** "Thời hạn xin": không biết thì nói không biết — "— giờ" là chỗ trống đội lốt câu trả lời. */
function askedText(
  row: ApprovalRow,
  t: (key: string, o?: Record<string, unknown>) => string,
) {
  return row.payload?.hours === undefined
    ? t("approvals.hoursUnknown")
    : t("approvals.hours", { hours: row.payload.hours });
}

/**
 * Mốc hiệu lực của một phiếu. Phiếu đã THU HỒI thì mốc thật là lúc bị cắt (`updatedAt` — trạng
 * thái cuối, không đổi nữa), không phải hạn gốc: in hạn gốc là nói quyền còn chạy tới đó.
 */
function validityText(
  row: ApprovalRow,
  t: (key: string, o?: Record<string, unknown>) => string,
) {
  if (row.state === "revoked") {
    return t("approvals.cutAt", {
      at: formatDateTime(row.updatedAt ?? row.decidedAt),
    });
  }
  return row.expiresAt ? formatDateTime(row.expiresAt) : null;
}

/**
 * Màn duyệt break-glass (FR-023/FR-025).
 *
 * AC đòi màn này dùng được ở 390px, và lý do rất cụ thể: yêu cầu break-glass đến lúc 2 giờ
 * sáng, người duyệt đang ở nhà và chỉ có cái điện thoại. Duyệt không được trên điện thoại thì
 * cả cơ chế này vô dụng đúng vào lúc cần nhất — người trực sẽ đi tìm đường vòng.
 *
 * Chỉ tab "Chờ duyệt" có nút quyết. Nhật ký là sổ để TRA — nút Duyệt ở đó là hai nơi quyết cùng
 * một việc, và người đọc sổ vô tình cấp quyền từ màn đáng lẽ chỉ để xem.
 */
export function ApprovalsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const narrow = useMediaQuery(NARROW_QUERY);
  const canDecide = me.role === "sa" || me.role === "admin";
  /**
   * Member vào thẳng tab của mình — `tab` khởi tạo phải khớp tab `Tabs` đang sáng, không thì
   * nút sáng ở "Yêu cầu của tôi" mà dữ liệu render lại là của tab 'pending' (rỗng với Member).
   */
  const [tab, setTab] = useState(canDecide ? "pending" : "mine");
  const [deciding, setDeciding] = useState<{
    row: ApprovalRow;
    approve: boolean;
    revoke?: boolean;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /* `?id=` đến từ link thư cũ: yêu cầu đó lên đầu hàng chờ và được đánh dấu. Thư mới trỏ thẳng
     trang chi tiết `/approvals/<id>`. */
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("id");
  const focusRef = useRef<HTMLElement | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [logFilters, setLogFilters] = useState<LogFilters>(EMPTY_LOG_FILTERS);
  const [requesterInput, setRequesterInput] = useState("");
  const setLogFilter = useCallback((key: keyof LogFilters, value: string) => {
    setLogFilters((current) => (current[key] === value ? current : { ...current, [key]: value }));
    setLogPage(1);
  }, []);
  useEffect(() => {
    const handle = setTimeout(
      () => setLogFilter("requester", requesterInput.trim()),
      REQUESTER_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [requesterInput, setLogFilter]);
  const logQuery = logFilterQuery(logFilters);
  const logFiltered = logQuery !== "";
  const [minePage, setMinePage] = useState(1);
  const actions = useBreakGlassActions(me.csrfToken);
  const myEmail = me.email.toLowerCase();

  const pending = useQuery({
    queryKey: [...BREAK_GLASS_KEY, "pending"],
    queryFn: () => apiFetch<ApprovalRow[]>("/api/v1/vault/break-glass/pending"),
    enabled: canDecide,
    refetchInterval: PENDING_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const log = useQuery({
    queryKey: [...BREAK_GLASS_KEY, "log", logPage, logQuery],
    queryFn: () =>
      apiFetch<ApprovalPage>(
        `/api/v1/vault/break-glass/log?page=${logPage}&limit=${PAGE_LIMIT}${logQuery ? `&${logQuery}` : ""}`,
      ),
    enabled: canDecide && tab === "log",
  });

  /* Quyền đang chạy ghim đầu tab Nhật ký (VLT-020): nhật ký chia trang theo lúc gửi, quyền
     cần thu hồi có thể đã trôi sang trang sau. */
  const activeGrants = useQuery({
    queryKey: [...BREAK_GLASS_KEY, "active"],
    queryFn: () => apiFetch<ApprovalRow[]>("/api/v1/vault/break-glass/active"),
    enabled: canDecide && tab === "log",
  });

  const mine = useQuery({
    queryKey: [...BREAK_GLASS_KEY, "mine", minePage],
    queryFn: () =>
      apiFetch<ApprovalPage>(
        `/api/v1/vault/break-glass/mine?page=${minePage}&limit=${PAGE_LIMIT}`,
      ),
    enabled: tab === "mine",
  });

  /**
   * Chạy một lệnh trên MỘT phiếu: khoá nút của phiếu đó, báo kết quả, làm mới mọi nơi đang
   * hiện phiếu.
   */
  const runOn = async (
    row: ApprovalRow,
    work: () => Promise<unknown>,
    done: string,
  ) => {
    setBusyId(row.id);
    try {
      await work();
      toast({ message: t(done) });
      void actions.refresh();
    } catch (error) {
      if (!isStepUpCancelled(error))
        toast({ message: errorMessage(error), tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const cancelOwn = (row: ApprovalRow) => {
    void (async () => {
      const ok = await askConfirm({
        title: t("common.titleOf", {
          action: t("approvals.cancel"),
          subject: row.subjectLabel ?? t("approvals.subjectGone"),
        }),
        message: t("approvals.confirmCancel"),
        danger: true,
        confirmLabel: t("approvals.cancel"),
      });
      if (ok)
        await runOn(row, () => actions.cancel(row.id), "approvals.cancelled");
    })();
  };

  /**
   * `query` của tab đang xem — lấy MỘT lần rồi rút cả ba trạng thái từ đó. Không có nhánh lỗi
   * thì một API 500 thành mảng rỗng, và người trực đêm đọc ra "không ai đang xin quyền" trong
   * khi phiếu đang nằm đó.
   */
  const active = tab === "pending" ? pending : tab === "log" ? log : mine;
  const loaded =
    (tab === "pending"
      ? pending.data
      : tab === "log"
        ? log.data?.items
        : mine.data?.items) ?? [];
  const focused =
    focusId && tab === "pending"
      ? loaded.find((row) => row.id === focusId)
      : undefined;
  const items = focused
    ? [focused, ...loaded.filter((row) => row !== focused)]
    : loaded;
  // Yêu cầu trong thư đã được người khác xử lý: nói ra, đừng để người duyệt tưởng link hỏng.
  const focusGone =
    Boolean(focusId) && tab === "pending" && pending.isSuccess && !focused;
  // Hàng chờ duyệt tự giới hạn (mỗi người một yêu cầu treo trên một đối tượng) nên không phân trang.
  const paged =
    tab === "log"
      ? { page: logPage, set: setLogPage, total: log.data?.total ?? 0 }
      : tab === "mine"
        ? { page: minePage, set: setMinePage, total: mine.data?.total ?? 0 }
        : null;

  // Phiếu mở từ thư: đưa vào giữa màn một lần khi nó hiện ra — trên điện thoại nó có thể nằm dưới nếp gấp.
  const focusedId = focused?.id;
  useEffect(() => {
    if (!focusedId) return;
    focusRef.current?.scrollIntoView?.({ block: "center" });
  }, [focusedId]);

  const tabs = [
    ...(canDecide
      ? [
          {
            key: "pending",
            label: t("approvals.tabPending"),
            count: pending.data?.length,
          },
          { key: "log", label: t("approvals.tabLog") },
        ]
      : []),
    { key: "mine", label: t("approvals.tabMine") },
  ];

  /*
    Nút Xuất CHỈ ở tab Nhật ký, và file theo đúng bộ lọc đang xem — để ở tab khác là người
    đang xem "Chờ duyệt" im lặng nhận cả kho. File không có cột nào chứa mật khẩu (FR-026).
  */
  const exportButton =
    canDecide && tab === "log" ? (
      <ExportXlsxButton
        url={`/api/v1/vault/break-glass/export.xlsx${logQuery ? `?${logQuery}` : ""}`}
        fileName="nhat-ky-mo-ket.xlsx"
      />
    ) : null;

  return (
    <>
      <PageHeader
        /* Member không duyệt gì cả — màn của họ là "yêu cầu xem két của tôi". */
        title={t(canDecide ? "approvals.title" : "approvals.titleMine")}
        subtitle={t(
          canDecide ? "approvals.subtitle" : "approvals.subtitleMine",
        )}
        actions={narrow ? null : exportButton}
      />

      {/* Một tab thôi thì thanh tab chỉ là một vạch trang trí — bỏ. */}
      {tabs.length > 1 ? (
        <Tabs
          items={tabs}
          value={tab}
          onChange={setTab}
          ariaLabel={t("approvals.title")}
        />
      ) : null}

      <TabPanel tabKey={tab}>
        {tab === "log" ? (
          <FilterBar
            search={requesterInput}
            onSearchChange={setRequesterInput}
            searchPlaceholder={t("approvals.filterRequester")}
            activeCount={
              [logFilters.state, logFilters.requester, logFilters.from, logFilters.to].filter(Boolean)
                .length
            }
            onClear={() => {
              setRequesterInput("");
              setLogFilters(EMPTY_LOG_FILTERS);
              setLogPage(1);
            }}
          >
            <Select
              value={logFilters.state}
              ariaLabel={t("approvals.filterState")}
              placeholder={t("approvals.filterStateAll")}
              options={[
                { value: "", label: t("approvals.filterStateAll") },
                ...LOG_STATES.map((state) => ({ value: state, label: t(LOG_STATE_KEY[state]) })),
              ]}
              onChange={(value) => setLogFilter("state", value)}
            />
            <div className="filter-range" role="group" aria-label={t("approvals.filterDates")}>
              <DatePicker
                value={logFilters.from}
                ariaLabel={t("approvals.filterFrom")}
                placeholder={t("common.fromDate")}
                max={logFilters.to || undefined}
                onChange={(value) => setLogFilter("from", value)}
              />
              <DatePicker
                value={logFilters.to}
                ariaLabel={t("approvals.filterTo")}
                placeholder={t("common.toDate")}
                min={logFilters.from || undefined}
                onChange={(value) => setLogFilter("to", value)}
              />
            </div>
          </FilterBar>
        ) : null}
        {focusGone ? <p className="muted">{t("approvals.focusGone")}</p> : null}
        {tab === "log" && activeGrants.data && activeGrants.data.length > 0 ? (
          <section
            className="approval-active"
            aria-label={t("approvals.activeGroup", { count: activeGrants.data.length })}
          >
            <h2>{t("approvals.activeGroup", { count: activeGrants.data.length })}</h2>
            <LogTable
              rows={activeGrants.data}
              busyId={busyId}
              onRevoke={(row) => setDeciding({ row, approve: false, revoke: true })}
              onGoPending={() => setTab("pending")}
            />
          </section>
        ) : null}
        {active.isLoading ? (
          <Loading />
        ) : active.isError ? (
          <LoadError
            error={active.error}
            onRetry={() => void active.refetch()}
          />
        ) : items.length === 0 ? (
          <>
            <EmptyState
              title={t(
                tab === "pending"
                  ? "approvals.emptyPending"
                  : tab === "log"
                    ? logFiltered
                      ? "approvals.emptyLogFiltered"
                      : "approvals.emptyLog"
                    : "approvals.emptyMine",
              )}
              hint={
                tab === "pending" ? t("approvals.emptyPendingHint") : undefined
              }
            />
            {/* Người trực mở màn lúc 2 giờ sáng cần biết danh sách có tươi không. */}
            {tab === "pending" && pending.dataUpdatedAt ? (
              <p className="muted approval-fresh">
                {t("approvals.refreshedAt", {
                  at: formatDateTime(new Date(pending.dataUpdatedAt)),
                  seconds: PENDING_REFETCH_MS / 1000,
                })}
              </p>
            ) : null}
          </>
        ) : tab === "log" ? (
          <LogTable
            rows={items}
            busyId={busyId}
            onRevoke={(row) =>
              setDeciding({ row, approve: false, revoke: true })
            }
            onGoPending={() => setTab("pending")}
          />
        ) : (
          <div className="approval-list">
            {items.map((row) => {
              const own = row.requester.toLowerCase() === myEmail;
              const busy = busyId === row.id;
              const isFocused = row === focused;
              return (
                <section
                  key={row.id}
                  ref={isFocused ? focusRef : undefined}
                  className={
                    tab === "pending" && row.overdue
                      ? "card device-panel is-overdue"
                      : "card device-panel"
                  }
                  aria-label={t("approvals.cardLabel", {
                    member: row.requester,
                  })}
                  aria-current={isFocused ? "true" : undefined}
                >
                  <div
                    className="row"
                    style={{ gap: "var(--space-3)", flexWrap: "wrap" }}
                  >
                    <BreakGlassStateBadge row={row} />
                    {isFocused ? (
                      <span className="badge warn">
                        {t("approvals.fromMail")}
                      </span>
                    ) : null}
                    {/* Chờ quá mốc thư nhắc: chữ + viền, không chỉ màu (VLT-017). */}
                    {tab === "pending" && row.overdue ? (
                      <span className="badge warn">{t("approvals.waitingLong")}</span>
                    ) : null}
                    {/* Ở tab của mình thì người xin luôn là mình — đối tượng mới là tiêu đề thẻ. */}
                    {tab === "mine" ? null : (
                      <>
                        <strong>{row.requesterName}</strong>
                        {row.requesterName !== row.requester ? (
                          <span className="muted">{row.requester}</span>
                        ) : null}
                      </>
                    )}
                    <span className="muted">
                      <BreakGlassSentAgo at={row.createdAt} />
                    </span>
                  </div>

                  {/* Đối tượng NGAY dưới người xin, trước lý do: "máy nào" là câu người duyệt
                      hỏi đầu tiên để đánh giá rủi ro. */}
                  <BreakGlassSubject row={row} />

                  <p className="approval-reason">{row.reason}</p>

                  <dl className="data-grid">
                    <div className="field">
                      <dt className="lbl-t">{t("approvals.asked")}</dt>
                      <dd>{askedText(row, t)}</dd>
                    </div>
                    {row.decidedBy ? (
                      <div className="field">
                        <dt className="lbl-t">{t("approvals.decidedBy")}</dt>
                        <dd>
                          {row.decidedBy}
                          <span className="cell-sub">
                            {orDash(row.decisionNote)}
                          </span>
                        </dd>
                      </div>
                    ) : null}
                    {validityText(row, t) ? (
                      <div className="field">
                        <dt className="lbl-t">
                          {t(
                            row.state === "revoked"
                              ? "approvals.cutLabel"
                              : "approvals.expiresAt",
                          )}
                        </dt>
                        <dd>
                          {validityText(row, t)}
                          {/* `active` do SERVER tính bằng đồng hồ (AD-6). */}
                          {!row.active && row.state === "approved" ? (
                            <span className="cell-sub">
                              {t("approvals.alreadyOver")}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {canDecide &&
                  tab === "pending" &&
                  row.state === "pending" &&
                  !own ? (
                    /* Từ chối TRÁI (viền đỏ, không đặc), Duyệt PHẢI (vùng ngón cái). Trên điện
                       thoại hai nút chia đôi hàng, cao 48px, cách nhau đủ xa để không chạm nhầm. */
                    <div className="approval-decide">
                      <button
                        type="button"
                        className="btn danger-ghost"
                        onClick={() => setDeciding({ row, approve: false })}
                      >
                        {t("approvals.deny")}
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => setDeciding({ row, approve: true })}
                      >
                        {t("approvals.approve")}
                      </button>
                    </div>
                  ) : null}

                  <div className="action-cell">
                    {/* Phiếu của CHÍNH MÌNH: bốn mắt cấm tự duyệt — nói thẳng thay vì bày nút
                        Duyệt rồi để server từ chối; rút được ngay tại chỗ. */}
                    {own && row.state === "pending" ? (
                      <>
                        <span className="muted">
                          {t("approvals.ownRequest")}
                        </span>
                        <button
                          type="button"
                          className="btn sm danger-ghost"
                          disabled={busy}
                          onClick={() => cancelOwn(row)}
                        >
                          {t("approvals.cancel")}
                        </button>
                      </>
                    ) : null}

                    {/* Được duyệt rồi thì việc kế tiếp duy nhất là mở két của đúng hồ sơ đó. */}
                    {tab === "mine" &&
                    row.state === "approved" &&
                    row.active &&
                    row.subjectLabel ? (
                      <>
                        <Link
                          className="linkbtn primary"
                          to={`${OWNER_PATH[row.subjectType](row.subjectId)}?tab=vault`}
                        >
                          {t("approvals.openVault")}
                        </Link>
                        {row.expiresAt ? (
                          <span className="muted">
                            {t("approvals.validUntil", {
                              at: formatDateTime(row.expiresAt),
                            })}
                          </span>
                        ) : null}
                      </>
                    ) : null}

                    <Link className="linkbtn sm" to={PATHS.approval(row.id)}>
                      {t("approvals.openDetail")}
                    </Link>
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {paged && items.length > 0 ? (
          <Pagination
            page={paged.page}
            limit={PAGE_LIMIT}
            total={paged.total}
            onPageChange={paged.set}
          />
        ) : null}
        {narrow && exportButton ? (
          <div className="approval-export-end">{exportButton}</div>
        ) : null}
      </TabPanel>

      {actions.dialog}

      {deciding ? (
        <DecisionDialog
          row={deciding.row}
          approve={deciding.approve}
          revoke={deciding.revoke}
          csrfToken={me.csrfToken}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            toast({
              message: t(
                deciding.revoke
                  ? "approvals.revoked"
                  : deciding.approve
                    ? "approvals.approved"
                    : "approvals.denied",
              ),
            });
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Nhật ký dạng BẢNG (DataTable dùng chung): auditor so hàng theo cột, thẻ lưới cũ làm cột nhảy
 * chỗ giữa thẻ này với thẻ kia. ≤600px thành thẻ gọn ba dòng. Chỉ đọc — phiếu đang chờ trỏ
 * sang tab Chờ duyệt; nút duy nhất là Thu hồi sớm cho quyền còn chạy.
 */
function LogTable({
  rows,
  busyId,
  onRevoke,
  onGoPending,
}: {
  rows: ApprovalRow[];
  busyId: string | null;
  onRevoke: (row: ApprovalRow) => void;
  onGoPending: () => void;
}) {
  const { t } = useTranslation();

  const actionOf = useCallback(
    (row: ApprovalRow) =>
      row.state === "pending" ? (
        <button type="button" className="btn sm ghost" onClick={onGoPending}>
          {t("approvals.goPending")}
        </button>
      ) : row.state === "approved" && row.active ? (
        <button
          type="button"
          className="btn danger-ghost"
          disabled={busyId === row.id}
          onClick={() => onRevoke(row)}
        >
          {t("approvals.revoke")}
        </button>
      ) : null,
    [t, busyId, onRevoke, onGoPending],
  );

  const columns = useMemo<ColumnDef<ApprovalRow, unknown>[]>(
    () => [
      {
        id: "state",
        header: t("approvals.colState"),
        enableSorting: false,
        cell: ({ row }) => <BreakGlassStateBadge row={row.original} />,
      },
      {
        id: "requester",
        header: t("approvals.requesterBlock"),
        enableSorting: false,
        cell: ({ row }) => (
          <>
            {row.original.requesterName}
            <span className="cell-sub">
              <BreakGlassSentAgo at={row.original.createdAt} />
            </span>
          </>
        ),
      },
      {
        id: "subject",
        header: t("approvals.subject"),
        enableSorting: false,
        cell: ({ row }) => <BreakGlassSubject row={row.original} />,
      },
      {
        id: "reason",
        header: t("approvals.reasonBlock"),
        enableSorting: false,
        meta: { className: "cell-note" },
        cell: ({ row }) => row.original.reason,
      },
      {
        id: "hours",
        header: t("approvals.asked"),
        enableSorting: false,
        cell: ({ row }) => askedText(row.original, t),
      },
      {
        id: "decided",
        header: t("approvals.decidedBy"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.decidedBy ? (
            <>
              {row.original.decidedBy}
              <span className="cell-sub">
                {formatDateTime(row.original.decidedAt)}
                {row.original.decisionNote
                  ? ` · ${row.original.decisionNote}`
                  : ""}
              </span>
            </>
          ) : (
            "—"
          ),
      },
      {
        id: "validity",
        header: t("approvals.expiresAt"),
        enableSorting: false,
        cell: ({ row }) => orDash(validityText(row.original, t)),
      },
      {
        id: "actions",
        header: t("common.actions"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="action-cell">
            {actionOf(row.original)}
            <Link className="linkbtn sm" to={PATHS.approval(row.original.id)}>
              {t("approvals.openDetail")}
            </Link>
          </div>
        ),
      },
    ],
    [t, actionOf],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      emptyText={t("approvals.emptyLog")}
      mobileCard={{
        title: (row) => row.requesterName,
        badge: (row) => <BreakGlassStateBadge row={row} />,
        subtitle: (row) => row.subjectLabel ?? t("approvals.subjectGone"),
        meta: (row) =>
          [
            askedText(row, t),
            row.decidedBy ? t("approvals.byWho", { who: row.decidedBy }) : null,
            validityText(row, t),
          ]
            .filter(Boolean)
            .join(" · "),
        actions: (row) => actionOf(row),
        href: (row) => PATHS.approval(row.id),
      }}
    />
  );
}
