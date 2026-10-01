import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate, orDash } from "@/lib/format";
import { maskOfCidr } from "@/lib/ipv4";
import type { Me } from "@/lib/me";
import { AttachmentPanel, useOwnerAttachments } from "@/ui/attachment-panel";
import { CellNote } from "@/ui/cell-note";
import { CopyButton } from "@/ui/copy-button";
import { Dialog } from "@/ui/dialog";
import { DatePicker } from "@/ui/date-picker";
import { EmptyState, LoadError, Loading } from "@/ui/load-state";
import { Field } from "@/ui/page-header";
import { Pagination } from "@/ui/pagination";
import { SegmentedRadio } from "@/ui/segmented-radio";
import { SkeletonRows } from "@/ui/skeleton-rows";
import { RowActions, type RowAction } from "@/ui/row-actions";
import { SuggestInput } from "@/ui/suggest-input";
import { useDepartments } from "@/ui/use-departments";
import { reasonRule, secretTextRule, useFormErrors, useSubmitError } from "@/ui/use-form-errors";
import { FilterBar } from "@/ui/filter-bar";
import { useToast } from "@/ui/toast";
import { HistoryPanel } from "@/ui/history-panel";
import {
  NEXT_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  TRANSITION_LABEL,
  type IpRow,
  type IpStatus,
  type SubnetRow,
  type SubnetSlot,
} from "./ipam-types";
import {
  BUCKET_KEY,
  countSlots,
  filterSlots,
  nextFreeSlot,
  freeChoices,
  shouldIsolateAssigned,
  pageOfAddress,
  pageSlots,
  searchSlots,
  SLOT_FILTERS,
  SLOT_PAGE_SIZE,
  VOIDED_FILTER,
  type SlotFilter,
} from "./slot-paging";
import { toIpHistoryEntries, type IpHistoryRow } from "./ip-history-entries";
import { AssignIpDialog, IpDeviceCombobox, ownerRule } from "./ip-assign-dialog";
import { SubnetMap } from "./subnet-map";
import { PATHS } from "@/lib/routes";
import { clampPage } from "@/lib/paging";

/** Rule NAT đọc ở hộp Thu hồi — chỉ những trường cần để nói "rule nào đang trỏ vào IP này". */
interface NatRef {
  id: string;
  protocol: string;
  externalPorts: string;
  internalIp: string;
  internalPort: number;
  deviceCode: string | null;
  voidedAt: string | null;
}

/**
 * Cột PHẢI của màn Địa chỉ IP: toàn bộ một dải — IP đã có hồ sơ và ô còn trống, xếp theo thứ
 * tự địa chỉ.
 *
 * Ô trống hiện luôn trong bảng chứ không giấu sau một nút "thêm IP": câu hỏi thật khi cắm máy
 * là "còn chỗ nào trống", và nhìn thấy chỗ trống rồi bấm vào đó là đường ngắn nhất.
 *
 * Nhận cả bản ghi dải qua props (cột trái đã tải danh sách rồi) — không hỏi lại API cho một
 * thứ đang nằm sẵn trong tay.
 */
export function SubnetPane({
  subnet: item,
  me,
}: {
  subnet: SubnetRow;
  me: Me;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const id = item.id;
  /*
   * `null` = NGƯỜI DÙNG CHƯA CHỌN GÌ, để bên dưới tự chọn hộ theo dải đang mở. Khác hẳn
   * `"all"` — đó là một lựa chọn thật sự của người dùng và phải được tôn trọng.
   */
  const [status, setStatus] = useState<SlotFilter | null>(null);
  const [page, setPage] = useState(1);
  /** Danh sách hay bản đồ — hai cách xem cùng một dải. */
  const [view, setView] = useState<"list" | "map">("list");
  /** Hồ sơ đang mở hộp SỬA. Cấp mới đi hộp riêng (`assigning`) — hai việc, hai hộp. */
  const [editing, setEditing] = useState<IpRow | null>(null);
  /** Hộp "Cấp IP" — `record` null là ô chưa từng có hồ sơ, có là hồ sơ đang Trống. */
  const [assigning, setAssigning] = useState<{
    address: string;
    record: IpRow | null;
    /** Mở từ nút "Cấp IP trống kế tiếp" — chỉ lối này cho đổi địa chỉ trong hộp. */
    fromNext?: boolean;
  } | null>(null);
  /** Chỉ còn bước THU HỒI đi hộp này; bước cấp đã gộp vào `assigning`. */
  const [moving, setMoving] = useState<{ record: IpRow; to: IpStatus } | null>(
    null,
  );
  /** Ô tìm ngay trên bảng — lọc tại chỗ trên cả dải. */
  const [needle, setNeedle] = useState("");
  /**
   * `?ip=` — đến từ ô tra cứu cấp trang, hộp Tìm nhanh hoặc panel IP của trang thiết bị: nhảy
   * tới đúng trang chứa địa chỉ và tô sáng dòng. Đọc từ URL để link gửi cho nhau mở ra đúng chỗ.
   */
  const [params] = useSearchParams();
  const focusIp = params.get("ip");
  const [highlight, setHighlight] = useState<string | null>(null);
  const appliedFocus = useRef<string | null>(null);
  const highlightRow = useRef<HTMLTableRowElement | null>(null);
  const scrolledTo = useRef<string | null>(null);
  const [historyOf, setHistoryOf] = useState<IpRow | null>(null);
  /** Hồ sơ IP nhập nhầm đang chờ XÓA (kèm lý do) — khác `moving` vốn là bước vòng đời. */
  const [voiding, setVoiding] = useState<IpRow | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  /**
   * Dải ĐÃ VÔ HIỆU HÓA thì cả bảng này chỉ còn ĐỌC.
   *
   * Hồ sơ IP vẫn hiện nguyên — đó chính là điểm: mấy cái máy ngoài kia không tự nhả IP tĩnh
   * ra chỉ vì cuốn sổ cất dải đi, nên giấu chúng đi là nói dối. Nhưng cấp mới, chuyển trạng
   * thái hay sửa thì API từ chối (`cidrOf` đòi dải còn sống), và một cái nút bấm vào rồi bị
   * từ chối là cái nút không nên có. Muốn sửa thì bật lại dải trước.
   */
  const subnetDisabled = item.voidedAt !== null;
  /**
   * Cấp IP · chuyển trạng thái · sửa hồ sơ: CẢ TEAM IT làm được (`@Roles('sa','admin','member')`).
   * Người cắm máy chính là người biết IP nào vừa cấp — bắt họ chờ Admin duyệt thì cuốn sổ sẽ
   * quay về file Excel trên máy ai đó.
   */
  const canWrite = !subnetDisabled;
  /**
   * XÓA hồ sơ nhập nhầm và ghi giấy tờ của dải thì chỉ SA/Admin — API chặn, UI đừng bày nút
   * ra để bấm rồi 403.
   */
  const isManager = me.role === "sa" || me.role === "admin";
  const canEdit = isManager && !subnetDisabled;

  /*
   * Hồ sơ đã XÓA (nhập nhầm, Q-15) không về màn này nữa: xóa là để nhập lại, ô trở thành chỗ
   * trống ngay, và vết của nó nằm trong Nhật ký hệ thống. Chỉ dải ĐÃ NGỪNG DÙNG mới có hồ sơ
   * tắt hiện ra — những hồ sơ tắt CÙNG dải, API tự trả kèm.
   */
  const slots = useQuery({
    queryKey: ["ipam", "subnets", id, "addresses"],
    queryFn: () => apiFetch<SubnetSlot[]>(`/api/v1/ipam/subnets/${id}/addresses`),
  });

  const attachments = useOwnerAttachments("subnet", id);

  // Chỉ dải và IP của dải — sổ NAT và các màn khác không đổi khi cấp/thu hồi một địa chỉ.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ipam", "subnets"] });

  /*
   * Dải đã tắt: bỏ các ô CHƯA TỪNG CÓ HỒ SƠ. Không cấp được gì trong dải này, nên 254 dòng
   * "Trống" không bấm được chỉ chôn mất mấy hồ sơ còn lại — thứ duy nhất đáng tra ở đây.
   */
  const all = useMemo(() => {
    const raw = slots.data ?? [];
    return subnetDisabled ? raw.filter((slot) => slot.kind === "record") : raw;
  }, [slots.data, subnetDisabled]);
  const counts = useMemo(() => countSlots(all), [all]);
  const allRef = useRef(all);
  allRef.current = all;

  /*
   * MẶC ĐỊNH CHỌN HỘ — nhưng chỉ MỘT LẦN, lúc dải vừa mở ra.
   *
   * Một /24 đã dùng 12 địa chỉ thì mở ra là 242 ô trống xếp trước mặt, 12 dòng có dữ liệu nằm
   * rải trong sáu trang. Nhưng cũng KHÔNG được mặc định "Đang dùng" cho mọi dải: một /29 mới
   * khai có 6 ô trống thì "Đang dùng" mở ra một bảng rỗng, mà chính 6 ô trống ấy mới là thứ
   * người ta vào để bấm "Cấp IP". Luật nằm ở `shouldIsolateAssigned`.
   *
   * Ghim bằng `ref` thay vì tính lại mỗi lượt render: tính lại thì ngay sau khi người dùng
   * cấp một IP trên dải rộng, `assigned` nhảy từ 0 lên 1 và bộ lọc tự đổi dưới tay họ.
   */
  const decidedFor = useRef<string | null>(null);

  /*
   * Đổi DẢI thì về trang 1, bỏ bộ lọc cũ, VÀ cho phép quyết lại.
   *
   * Khối này PHẢI khai trước khối quyết: React chạy effect theo THỨ TỰ KHAI, và khi `id` đổi
   * cùng một commit mà dữ liệu dải mới đã có sẵn trong cache, đặt ngược thứ tự thì khối reset
   * chạy SAU khối quyết và xoá mất lựa chọn vừa quyết — còn `decidedFor` đã ghim nên không
   * bao giờ quyết lại cho dải đó.
   */
  useEffect(() => {
    setPage(1);
    setStatus(null);
    setNeedle("");
    setHighlight(null);
    setView("list");
    decidedFor.current = null;
  }, [id]);

  useEffect(() => {
    if (!slots.data || decidedFor.current === id) return;
    decidedFor.current = id;
    const fresh = countSlots(all);
    setStatus(shouldIsolateAssigned(fresh.assigned, fresh.free) ? "assigned" : "all");
  }, [slots.data, all, id]);

  /*
   * Nhảy tới địa chỉ được hỏi — khai SAU khối quyết để thắng nó trong cùng một commit: địa
   * chỉ cần tra có thể đang Trống, và bộ lọc "Đang dùng" mà khối quyết chọn hộ sẽ giấu mất
   * đúng dòng đó. Mỗi cặp dải + địa chỉ chỉ áp MỘT lần — áp lại sau mỗi lượt tải là giật
   * trang dưới tay người dùng.
   */
  useEffect(() => {
    if (!slots.data || !focusIp) return;
    const key = `${id}|${focusIp}`;
    if (appliedFocus.current === key) return;
    appliedFocus.current = key;
    decidedFor.current = id;
    setStatus("all");
    setNeedle("");
    setPage(pageOfAddress(all, focusIp) ?? 1);
    setHighlight(focusIp);
  }, [slots.data, all, focusIp, id]);

  const shown: SlotFilter = status ?? "all";
  const filtered = useMemo(
    () => searchSlots(filterSlots(all, shown), needle),
    [all, shown, needle],
  );

  /**
   * Phân trang Ở CLIENT, cố ý: `ipam.subnet_min_prefix` (không dưới 24) chặn dải rộng nhất ở /24 = 254 host,
   * nên cả dải về trong MỘT lượt gọi. Cắt trang ở đây thì bộ lọc và con số đếm trên từng nút
   * vẫn tính trên TOÀN dải — đó mới là câu trả lời đúng cho "còn mấy chỗ trống".
   */
  const rows = pageSlots(filtered, page);

  // Đổi bộ lọc thì số dòng đổi theo; giữ nguyên trang 5 của tập cũ là nhìn vào một bảng
  // rỗng và tưởng không có gì.
  useEffect(() => {
    setPage((current) => clampPage(current, filtered.length, SLOT_PAGE_SIZE));
  }, [filtered.length]);

  // Cuộn tới dòng được tô sáng một lần — trên điện thoại nó thường nằm dưới mép màn hình.
  useEffect(() => {
    if (!highlight || scrolledTo.current === highlight) return;
    if (!highlightRow.current) return;
    scrolledTo.current = highlight;
    highlightRow.current.scrollIntoView?.({ block: "center" });
  });

  /** Chỗ trống nhỏ nhất (bỏ qua gateway) cho nút "Cấp IP trống kế tiếp". */
  const next = useMemo(
    () => nextFreeSlot(slots.data ?? [], item.gateway),
    [slots.data, item.gateway],
  );

  /** Bấm một ô ĐANG DÙNG trên bản đồ: về danh sách, đúng trang, tô sáng dòng đó. */
  const openInList = (address: string) => {
    setView("list");
    setStatus("all");
    setNeedle("");
    setPage(pageOfAddress(all, address) ?? 1);
    scrolledTo.current = null;
    setHighlight(address);
  };

  /** Nút "Cấp IP" trên dòng — ô trống và hồ sơ Trống mở cùng một hộp. */
  const assignButton = (address: string, record: IpRow | null) =>
    canWrite ? (
      <button
        type="button"
        className="btn sm ghost"
        onClick={() => setAssigning({ address, record })}
      >
        {t("ipam.assign")}
      </button>
    ) : null;

  const ipHead = (
    <thead>
      <tr>
        <th>{t("ipam.address")}</th>
        <th>{t("ipam.status")}</th>
        <th className="col-device">{t("ipam.device")}</th>
        <th>{t("ipam.site")}</th>
        <th>{t("ipam.usedBy")}</th>
        <th className="col-date">{t("ipam.assignedAt")}</th>
        <th className="col-center">{t("common.actions")}</th>
      </tr>
    </thead>
  );

  const mask = maskOfCidr(item.cidr);
  const gatewaySlot = item.gateway
    ? (slots.data ?? []).find((slot) => slot.address === item.gateway)
    : undefined;
  const gatewayDevice =
    gatewaySlot?.kind === "record" && !gatewaySlot.voidedAt && gatewaySlot.deviceId
      ? { id: gatewaySlot.deviceId, code: gatewaySlot.deviceCode ?? "" }
      : null;

  return (
    <>
      {/*
        Đầu cột phải: tên dải + mọi thứ người cắm máy cần gõ vào card mạng (gateway, mask,
        VLAN), kèm mô tả và giấy tờ của dải. Không lặp thanh mức sử dụng — thẻ dải bên trái
        đã hiện đúng con số đó.
      */}
      <div className="pane-head">
        <div className="pane-head-main">
          <h2 className="pane-title">
            <span className="mono">{item.cidr}</span> — {item.name}
          </h2>
          <p className="pane-sub">
            {item.gateway ? (
              <span>
                {t("ipam.gateway")}: <span className="mono">{item.gateway}</span>{" "}
                <CopyButton
                  value={item.gateway}
                  label={t("ipam.copyOf", { label: t("ipam.gateway") })}
                  inline
                />
                {/* Máy đang giữ địa chỉ gateway (router/firewall) — nối dải với thiết bị biên,
                    đọc từ chính hồ sơ IP của dải, không hỏi thêm gì. */}
                {gatewayDevice ? (
                  <>
                    {" → "}
                    <Link className="mono" to={PATHS.device(gatewayDevice.id)}>
                      {gatewayDevice.code}
                    </Link>
                  </>
                ) : null}
              </span>
            ) : null}
            {mask ? (
              <span>
                {t("ipam.mask")}: <span className="mono">{mask}</span>
              </span>
            ) : null}
            {item.vlan !== null ? (
              <span>{t("ipam.vlanBadge", { vlan: item.vlan })}</span>
            ) : null}
            {item.siteCode ? <span>{item.siteCode}</span> : null}
            <span className="muted">
              {t("ipam.createdBy", { by: item.createdBy, date: formatDate(item.createdAt) })}
            </span>
          </p>
          {item.description ? <p className="muted pane-desc">{item.description}</p> : null}
        </div>
        <div className="pane-actions">
          <button type="button" className="btn" onClick={() => setFilesOpen(true)}>
            {t("ipam.filesButton", { count: attachments.data?.length ?? 0 })}
          </button>
          {canWrite ? (
            <button
              type="button"
              className="btn primary"
              disabled={!next}
              title={next ? undefined : t("ipam.nextFreeNone")}
              onClick={() => (next ? setAssigning({ ...next, fromNext: true }) : undefined)}
            >
              {t("ipam.nextFree")}
            </button>
          ) : null}
        </div>
      </div>

      {/* Nói NGAY vì sao mọi nút biến mất, ai tắt và lúc nào. Không có dòng này thì bảng
          chỉ-đọc trông như hỏng. */}
      {subnetDisabled ? (
        <div className="alert warn" role="note">
          <p>
            {t("ipam.voidedBy", {
              date: formatDate(item.voidedAt),
              by: item.voidedBy ?? "—",
              reason: item.voidReason ?? "—",
            })}
          </p>
          <p>{t("ipam.voidedSlotHint")}</p>
        </div>
      ) : null}

      <div className="pane-tools">
        {/* Bộ lọc trạng thái — "Trống" là một lựa chọn ngang hàng, không phải một ô tick phụ.
            Con số đi kèm ngay trên nút: "còn mấy chỗ trống" là câu hỏi màn này sinh ra để trả
            lời. Chip "Đã ngừng dùng" chỉ có ở dải đã ngừng dùng — dải đang dùng không còn hồ sơ
            tắt nào hiện ra (hồ sơ nhập nhầm bị xóa hẳn khỏi màn, Q-15). */}
        <SegmentedRadio
          label={t("ipam.status")}
          value={shown}
          onChange={(key) => {
            setStatus(key);
            setPage(1);
            setView("list");
          }}
          options={(subnetDisabled ? [...SLOT_FILTERS, VOIDED_FILTER] : SLOT_FILTERS).map(
            (key) => ({
              value: key,
              label: (
                <>
                  {t(key === "all" ? "ipam.filterAll" : BUCKET_KEY[key])}{" "}
                  <span className="seg-count">{counts[key]}</span>
                </>
              ),
            }),
          )}
        />
        {!subnetDisabled ? (
          <SegmentedRadio<"list" | "map">
            label={t("ipam.viewGroup")}
            value={view}
            onChange={setView}
            options={(["list", "map"] as const).map((key) => ({
              value: key,
              label: t(key === "list" ? "ipam.viewList" : "ipam.viewMap"),
            }))}
          />
        ) : null}
      </div>

      {view === "list" ? (
        <FilterBar
          search={needle}
          onSearchChange={(value) => {
            setNeedle(value);
            setPage(1);
          }}
          searchPlaceholder={t("ipam.paneSearch")}
        />
      ) : null}

      {slots.isLoading ? (
        /* Khung xương đúng hình bảng IP: dữ liệu về thì bảng "đầy lên" tại chỗ, cột trái và
           đầu cột phải không nhảy. */
        <div className="table-wrap">
          <table className="table table-stack ip-table">
            {ipHead}
            <tbody>
              <SkeletonRows columns={6} rows={10} />
            </tbody>
          </table>
        </div>
      ) : slots.isError ? (
        <LoadError error={slots.error} onRetry={() => void slots.refetch()} />
      ) : subnetDisabled && item.addressCount === 0 ? (
        <EmptyState title={t("ipam.slotEmpty")} hint={t("ipam.voidedNeverUsed")} />
      ) : view === "map" ? (
        <SubnetMap
          cidr={item.cidr}
          slots={all}
          gateway={item.gateway}
          canAssign={canWrite}
          onAssign={(address, record) => setAssigning({ address, record })}
          onOpen={openInList}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table table-stack ip-table">
              {ipHead}
              <tbody>
                {rows.map((slot) =>
                  slot.kind === "free" ? (
                    <tr
                      key={slot.address}
                      className={
                        slot.address === highlight ? "row-highlight" : "row-muted"
                      }
                      ref={slot.address === highlight ? highlightRow : undefined}
                    >
                      <td data-label={t("ipam.address")} className="col-ip">
                        <span className="mono">{slot.address}</span>
                      </td>
                      <td data-label={t("ipam.status")} className="col-status">
                        <span className="badge muted">
                          {t("ipam.statusFree")}
                        </span>
                      </td>
                      <td data-label={t("ipam.device")}>
                        <Empty />
                      </td>
                      <td data-label={t("ipam.site")}>
                        <Empty />
                      </td>
                      <td data-label={t("ipam.usedBy")}>
                        <Empty />
                      </td>
                      <td data-label={t("ipam.assignedAt")}>
                        <Empty />
                      </td>
                      {/* Ô Thao tác cũng phải có `data-label`: ở ≤960px bảng gập thẻ dọc và
                          năm ô kia đều tự xưng tên, riêng ô này thì không — thành ra một cái
                          nút lửng lơ không biết thuộc cột nào. */}
                      <td data-label={t("common.actions")} className="col-actions">
                        <div className="action-cell">{assignButton(slot.address, null)}</div>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={slot.id}
                      /*
                        Hồ sơ đang Trống (đã thu hồi) nhìn như ô trống: mờ, và nút "Cấp IP"
                        ngay tại dòng. Để đậm như hồ sơ đang dùng thì người đọc thấy một dòng
                        "có gì đó" mà không biết là gì.
                      */
                      className={
                        slot.address === highlight
                          ? "row-highlight"
                          : isFreeRecord(slot)
                            ? "row-muted"
                            : undefined
                      }
                      ref={slot.address === highlight ? highlightRow : undefined}
                    >
                      <td data-label={t("ipam.address")} className="col-ip">
                        <span className="mono">{slot.address}</span>
                      </td>
                      <td data-label={t("ipam.status")} className="col-status">
                        {/*
                          Hồ sơ tắt theo dải phải đọc ra là đã ngừng dùng, không phải "Đang
                          dùng" mờ mờ: nó giữ nguyên `status` cũ, nên vẽ theo `status` là nói
                          dối về một hàng không cấp hay sửa được.
                        */}
                        {slot.voidedAt ? (
                          <span className="badge danger" title={slot.voidReason ?? undefined}>
                            {t("ipam.voidedBadge")}
                          </span>
                        ) : (
                          <span className={`badge ${STATUS_TONE[slot.status]}`}>
                            {t(STATUS_KEY[slot.status])}
                          </span>
                        )}
                        {/* Hồ sơ đã thu hồi: nói lúc nào và của ai trước đó — cấp lại cho
                            đúng máy cũ là việc hay gặp nhất sau một lượt thay máy. */}
                        {isFreeRecord(slot) ? (
                          <span className="cell-sub">
                            {t("ipam.freedOn", { date: formatDate(slot.updatedAt) })}
                            {slot.previousOwner
                              ? ` · ${t("ipam.previousOwner", { owner: slot.previousOwner })}`
                              : null}
                          </span>
                        ) : null}
                      </td>
                      <td data-label={t("ipam.device")} className="col-device">
                        {/* Mã máy một dòng (`.mono` trong ô bảng không ngắt), tên máy là dòng
                            phụ: mắt dò theo mã, tên để chắc là đúng cái máy mình nghĩ. */}
                        {slot.deviceId ? (
                          <>
                            <Link className="mono" to={PATHS.device(slot.deviceId)}>
                              {slot.deviceCode}
                            </Link>
                            {slot.deviceName ? (
                              <span className="cell-sub">{slot.deviceName}</span>
                            ) : null}
                          </>
                        ) : (
                          <Empty />
                        )}
                      </td>
                      {/* Site của MÁY, không của dải: dải để trống site là dùng chung mọi
                          site (Q-20), nên chỉ hồ sơ thiết bị nói được IP này đang ở đâu. */}
                      <td data-label={t("ipam.site")}>
                        {slot.deviceSiteCode ? slot.deviceSiteCode : <Empty />}
                      </td>
                      <td data-label={t("ipam.usedBy")}>
                        {slot.usedBy ? slot.usedBy : <Empty />}
                        {/* Ghi chú đọc được ngay trên bảng — cả với dải đã tắt, nơi hộp Sửa
                            không còn mở được. Một dòng, bị cắt thì bấm để mở đủ câu. */}
                        {slot.note ? <CellNote text={slot.note} className="cell-sub" /> : null}
                      </td>
                      <td data-label={t("ipam.assignedAt")} className="col-date">
                        {isFreeRecord(slot) || !slot.assignedAt ? (
                          <Empty />
                        ) : (
                          <>
                            {formatDate(slot.assignedAt)}
                            <span className="cell-sub" title={slot.assignedBy}>
                              {t("ipam.assignedByLine", { by: slot.assignedBy.split("@")[0] })}
                            </span>
                          </>
                        )}
                      </td>
                      <td data-label={t("common.actions")} className="col-actions">
                        <div className="action-cell">
                          {isFreeRecord(slot) ? assignButton(slot.address, slot) : null}
                          {/*
                            Gom vào một menu: bày từng nút cạnh nhau làm cột cuối rộng hơn cả các
                            cột dữ liệu cộng lại, trên một bảng người ta mở ra để ĐỌC địa chỉ.
                          */}
                          <RowActions
                            primary={
                              // Hồ sơ Trống thì "sửa" chính là cấp — đã có nút Cấp IP trên dòng.
                              canWrite && !slot.voidedAt && !isFreeRecord(slot)
                                ? {
                                    label: t("common.edit"),
                                    ariaLabel: t("common.editOf", { subject: slot.address }),
                                    onClick: () => setEditing(slot),
                                  }
                                : undefined
                            }
                            label={t("common.actionsOf", { subject: slot.address })}
                            items={rowActions(slot)}
                          />
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          {/*
            BẢNG RỖNG PHẢI NÓI VÌ SAO RỖNG: lọc "Đang dùng" trên một dải chưa cấp ô nào mà chỉ ra
            khung bảng trắng thì người dùng không biết đó là "dải sạch" hay "màn hỏng".
          */}
          {filtered.length === 0 ? (
            <EmptyState
              title={t("ipam.slotEmpty")}
              hint={shown === "all" ? t("ipam.slotEmptyAll") : t("ipam.slotEmptyFiltered")}
            />
          ) : null}

          <Pagination
            page={clampPage(page, filtered.length, SLOT_PAGE_SIZE)}
            limit={SLOT_PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </>
      )}

      {moving ? (
        <TransitionDialog
          record={moving.record}
          to={moving.to}
          csrfToken={me.csrfToken}
          onClose={() => setMoving(null)}
          onDone={() => {
            const address = moving.record.address;
            setMoving(null);
            /* Thu hồi xong, hồ sơ rời chip "Đang dùng" — đứng ở đó thì nó biến mất như bị xóa.
               Toast mang lối đi thẳng tới nó trong "Trống". */
            toast({
              message: t("ipam.transitioned"),
              action:
                shown === "assigned"
                  ? {
                      label: t("ipam.seeInFree"),
                      onClick: () => {
                        setStatus("free");
                        setNeedle("");
                        scrolledTo.current = null;
                        setHighlight(address);
                        // `allRef`: toast bấm SAU lượt tải lại — `all` của lúc đóng hộp còn
                        // xếp hồ sơ này ở "Đang dùng", tính trang theo nó là trang sai.
                        setPage(pageOfAddress(filterSlots(allRef.current, "free"), address) ?? 1);
                      },
                    }
                  : undefined,
            });
            void refresh();
          }}
        />
      ) : null}

      {voiding ? (
        <VoidAddressDialog
          record={voiding}
          csrfToken={me.csrfToken}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            toast({ message: t("ipam.addressVoided") });
            void refresh();
          }}
        />
      ) : null}

      {historyOf ? (
        <IpHistoryDialog
          record={historyOf}
          onClose={() => setHistoryOf(null)}
        />
      ) : null}

      {editing ? (
        <IpForm
          record={editing}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t("ipam.ipSaved") });
            void refresh();
          }}
        />
      ) : null}

      {assigning ? (
        <AssignIpDialog
          subnetId={id}
          address={assigning.address}
          record={assigning.record}
          network={{ cidr: item.cidr, gateway: item.gateway, vlan: item.vlan }}
          /* Chỉ lối "Cấp IP trống kế tiếp" cho đổi địa chỉ: máy chọn hộ chỗ nhỏ nhất, người cắm
             máy có thể muốn chỗ khác. Nút "Cấp IP" trên một dòng thì địa chỉ là chính dòng đó. */
          choices={assigning.fromNext ? freeChoices(slots.data ?? [], item.gateway) : undefined}
          csrfToken={me.csrfToken}
          onClose={() => setAssigning(null)}
          onDone={(address) => {
            setAssigning(null);
            toast({ message: t("ipam.assigned", { address }) });
            void refresh();
          }}
        />
      ) : null}

      {/* Giấy tờ của dải (sơ đồ mạng, biên bản bàn giao IP tĩnh) — đọc được với MỌI vai, ghi
          thì SA/Admin. Ở đây chứ không trong hộp Sửa dải: panel ghi thẳng, không hợp với một
          form có nút Hủy. */}
      {filesOpen ? (
        <Dialog
          open
          onOpenChange={() => setFilesOpen(false)}
          initialFocus="title"
          maxWidth={720}
          title={`${t("attachments.title")} — ${item.cidr}`}
          footer={
            <button type="button" className="btn" onClick={() => setFilesOpen(false)}>
              {t("common.close")}
            </button>
          }
        >
          <AttachmentPanel
            ownerType="subnet"
            ownerId={id}
            csrfToken={me.csrfToken}
            canEdit={isManager}
          />
        </Dialog>
      ) : null}
    </>
  );

  /** Menu ⋯ của một hồ sơ: việc hay làm trước, Thu hồi (đỏ), rồi Xóa nhập nhầm (xám) cuối. */
  function rowActions(slot: IpRow): RowAction[] {
    const items: RowAction[] = [];
    items.push({ key: "history", label: t("ipam.history"), onSelect: () => setHistoryOf(slot) });
    /* Chỉ những bước chuyển ĐI ĐƯỢC từ trạng thái hiện tại. Bước CẤP đã là nút trên dòng. */
    if (canWrite && !slot.voidedAt) {
      for (const to of NEXT_STATUSES[slot.status].filter((next) => next !== "assigned")) {
        items.push({
          key: `to-${to}`,
          label: t(TRANSITION_LABEL[`${slot.status}->${to}`]),
          hint: to === "free" ? t("ipam.reclaimMenuHint") : undefined,
          onSelect: () => setMoving({ record: slot, to }),
          // Q-19: IP về pool và cấp lại được — đảo được nên cam, không đỏ.
          warn: to === "free",
        });
      }
    }
    /*
     * XÓA hồ sơ — cho bản ghi KHAI NHẦM, khác "Thu hồi": thu hồi trả địa chỉ về pool nhưng
     * giữ hàng và lịch sử "IP này từng của máy nào" (AC 5.2) trên màn. Xếp cuối, chữ xám, có
     * vạch ngăn — nó hiếm khi đúng, và chọn nhầm nó thay vì Thu hồi là mất dòng khỏi màn (không
     * khôi phục trên giao diện, Q-15).
     */
    if (canEdit && !slot.voidedAt) {
      items.push({
        key: "void",
        label: t("ipam.voidAddress"),
        hint: t("ipam.voidMenuHint"),
        onSelect: () => setVoiding(slot),
        muted: true,
      });
    }
    return items;
  }
}

/** Ô trống: dấu gạch không mono, và điện thoại ẩn hẳn ô đó thay vì một hàng "— —". */
function Empty() {
  return <span className="cell-empty">{orDash(null)}</span>;
}

/**
 * Sửa một hồ sơ IP đang dùng. Cấp mới (ô trống hoặc hồ sơ Trống) đi `AssignIpDialog`.
 *
 * Gỡ hết máy lẫn người dùng của hồ sơ đang dùng là quay lại dòng mồ côi Q-14 cấm — muốn trả
 * địa chỉ về pool thì đi "Thu hồi", nơi lịch sử ghi lại chủ cũ.
 */
export function IpForm({
  record,
  csrfToken,
  onClose,
  onSaved,
}: {
  record: IpRow;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [device, setDevice] = useState({
    deviceId: record.deviceId ?? "",
    term: record.deviceCode ?? "",
  });
  const [usedBy, setUsedBy] = useState(record.usedBy ?? "");
  const departments = useDepartments();
  const [assignedAt, setAssignedAt] = useState(record.assignedAt ?? "");
  const [note, setNote] = useState(record.note ?? "");
  const [error, setError] = useSubmitError([device, usedBy, assignedAt, note]);
  const check = useFormErrors({
    owner: record.status === "assigned" ? ownerRule(t, device.deviceId, usedBy) : null,
    note: secretTextRule(t, note),
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    `/api/v1/ipam/addresses/${record.id}`,
    { method: "PATCH", csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      initialFocus="first-field"
      maxWidth={560}
      title={t("ipam.editIp", { address: record.address })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="ip-form"
            className="btn primary"
            disabled={save.isPending}
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </button>
        </>
      }
    >
      <form
        id="ip-form"
        className="form-grid"
        /* Hai cột: năm ô ngắn (địa chỉ · máy · người dùng · ngày cấp) xếp một cột dọc làm
           hộp cao gấp đôi cần thiết, phải cuộn mới thấy nút Lưu. Ghi chú `span={2}`. */
        data-columns={2}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(
            {
              deviceId: device.deviceId,
              usedBy: usedBy.trim(),
              assignedAt,
              note: note.trim(),
            },
            {
              onSuccess: onSaved,
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {/* Địa chỉ CỐ ĐỊNH ở hộp này — `.static-value` là lớp dành riêng cho "giá trị không
            sửa được trong form"; để `<p class="mono">` trần thì nó cao khác mọi ô còn lại và
            hàng đầu tiên trông lệch. */}
        <Field label={t("ipam.address")}>
          <p className="static-value mono">{record.address}</p>
        </Field>

        <Field label={t("ipam.device")} hint={t("ipam.deviceHint")} error={check.error("owner")}>
          <IpDeviceCombobox
            deviceId={device.deviceId}
            term={device.term}
            onChange={setDevice}
          />
        </Field>

        <Field label={t("ipam.usedBy")} hint={t("ipam.usedByHint")}>
          {/* Gợi ý từ danh mục Bộ phận, VẪN gõ tự do được: ô này đôi khi là một phòng, đôi
              khi là "Chị Lan — Kế toán", đôi khi là hai phòng dùng chung một máy in. Ép thành
              khóa ngoại là ép người dùng khai sai cho vừa cái ô. */}
          <SuggestInput
            value={usedBy}
            onChange={setUsedBy}
            options={departments.names}
            failed={departments.failed}
            placeholder={t("ipam.usedByPlaceholder")}
            ariaLabel={t("ipam.usedBy")}
          />
        </Field>

        <Field label={t("ipam.assignedAt")}>
          <DatePicker
            value={assignedAt}
            onChange={setAssignedAt}
            ariaLabel={t("ipam.assignedAt")}
          />
        </Field>

        <Field label={t("ipam.note")} hint={t("ipam.noteHint")} htmlFor="ip-note" span={2} error={check.error("note")}>
          <textarea
            id="ip-note"
            className="inp"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * Xác nhận bước THU HỒI.
 *
 * Nói rõ IP đang của AI trước khi lấy lại, và nói TRƯỚC nếu còn rule NAT trỏ vào nó — API
 * từ chối thu hồi địa chỉ còn là đích của rule NAT đang sống (thu hồi xong rule sẽ trỏ vào
 * một địa chỉ vô chủ), nên bày danh sách ra ở đây thay vì để người dùng bấm rồi ăn lỗi.
 *
 * Hỏi LÝ DO: sáu tháng sau, câu "vì sao IP này bị thu hồi" chỉ còn dòng lịch sử trả lời được.
 */
function TransitionDialog({
  record,
  to,
  csrfToken,
  onClose,
  onDone,
}: {
  record: IpRow;
  to: IpStatus;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useSubmitError([reason]);
  const check = useFormErrors({ reason: secretTextRule(t, reason) });

  const move = useApiMutation<Record<string, unknown>, unknown>(
    `/api/v1/ipam/addresses/${record.id}/transition`,
    { csrfToken, refreshMe: false },
  );

  const nat = useQuery({
    queryKey: ["ipam", "nat", "pointing-at", record.address],
    enabled: to === "free",
    queryFn: () =>
      apiFetch<NatRef[]>(`/api/v1/ipam/nat?search=${encodeURIComponent(record.address)}`),
  });
  const pointing = (nat.data ?? []).filter(
    (rule) => rule.internalIp === record.address && rule.voidedAt === null,
  );

  const owner = [record.deviceCode, record.usedBy].filter(Boolean).join(" · ");
  const label = t(TRANSITION_LABEL[`${record.status}->${to}`]);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!move.isPending}
      initialFocus="first-field"
      maxWidth={520}
      title={
        <>
          {label} — {record.address}
        </>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="transition-form"
            className={to === "free" ? "btn caution" : "btn primary"}
            disabled={move.isPending}
          >
            {move.isPending ? t("common.working") : label}
          </button>
        </>
      }
    >
      <form
        id="transition-form"
        ref={check.formRef}
        noValidate
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          move.mutate(
            { to, reason: reason.trim() },
            {
              onSuccess: onDone,
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {owner ? (
          <p>
            <b>{t("ipam.reclaimOwner", { who: owner })}</b>
            {record.assignedAt ? (
              <span className="muted">
                {" · "}
                {t("ipam.reclaimSince", { date: formatDate(record.assignedAt) })}
              </span>
            ) : null}
          </p>
        ) : null}

        {to === "free" ? (
          <p className="muted">{t("ipam.reclaimHint")}</p>
        ) : null}

        {pointing.length > 0 ? (
          <div className="alert warn" role="note">
            <p>
              {t("ipam.reclaimNatWarn", { count: pointing.length, address: record.address })}
            </p>
            <ul>
              {pointing.map((rule) => (
                <li key={rule.id} className="mono">
                  {rule.deviceCode ? `${rule.deviceCode} · ` : ""}
                  {rule.protocol.toUpperCase()} {rule.externalPorts} → {rule.internalIp}:
                  {rule.internalPort}
                </li>
              ))}
            </ul>
            <Link to={`${PATHS.nat}?search=${encodeURIComponent(record.address)}`}>
              {t("ipam.reclaimNatLink")}
            </Link>
          </div>
        ) : null}

        <Field
          label={t("ipam.reason")}
          hint={t("ipam.reasonHint")}
          htmlFor="tr-reason"
          error={check.error("reason")}
        >
          <input
            id="tr-reason"
            className="inp"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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

/** AC 5.2: lịch sử giữ VĨNH VIỄN và xem được ngay trên trang IP. */
function IpHistoryDialog({
  record,
  onClose,
}: {
  record: IpRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const history = useQuery({
    queryKey: ["ipam", "addresses", record.id, "history"],
    queryFn: () =>
      apiFetch<IpHistoryRow[]>(`/api/v1/ipam/addresses/${record.id}/history`),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      initialFocus="title"
      maxWidth={620}
      title={t("ipam.historyOf", { address: record.address })}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      {history.isLoading ? (
        <Loading />
      ) : history.isError ? (
        <LoadError error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <HistoryPanel
          entries={toIpHistoryEntries(history.data ?? [], t)}
          emptyText={t("ipam.historyEmpty")}
        />
      )}
    </Dialog>
  );
}


/**
 * Xóa MỘT hồ sơ IP khai nhầm, kèm lý do (Q-15: xóa để nhập lại).
 *
 * Cùng khuôn với hộp ngừng dùng dải và hộp gỡ luật NAT: "địa chỉ này biến đi đâu" là câu sáu tháng
 * sau sẽ có người hỏi, và chỉ dòng lịch sử trả lời được. Dùng hộp riêng chứ không dùng
 * `useConfirm` chung vì lý do ở đây là DỮ LIỆU bắt buộc, không phải một câu có/không.
 */
function VoidAddressDialog({
  record,
  csrfToken,
  onClose,
  onDone,
}: {
  record: IpRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useSubmitError([reason]);
  const check = useFormErrors({ reason: reasonRule(t, reason) });
  const remove = useApiMutation<{ reason: string }, unknown>(
    `/api/v1/ipam/addresses/${record.id}`,
    { method: "DELETE", csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!remove.isPending}
      initialFocus="first-field"
      maxWidth={480}
      title={`${t("ipam.voidAddressTitle")} — ${record.address}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="ip-void-form"
            className="btn danger"
            disabled={remove.isPending}
          >
            {remove.isPending ? t("common.working") : t("ipam.voidAddress")}
          </button>
        </>
      }
    >
      <form
        id="ip-void-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          remove.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t("ipam.voidAddressHint")}</p>
        <Field
          label={t("ipam.reason")}
          required
          htmlFor="ip-void-reason"
          error={check.error("reason")}
        >
          <input
            id="ip-void-reason"
            className="inp"
            required
            minLength={3}
            placeholder={t("ipam.voidAddressPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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

/** Hồ sơ còn sống mà đang Trống — với người đọc bảng, nó là một chỗ trống cấp được. */
function isFreeRecord(slot: IpRow): boolean {
  return slot.status === "free" && !slot.voidedAt;
}
