import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { Chevron } from "@/ui/chevron";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  DetailSection,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { LocationText } from "@/ui/location-text";
import { HistoryPanel } from "@/ui/history-panel";
import { AuditLogLink } from "@/ui/audit-log-link";
import { DetailLoadFailed, LoadError, Loading } from "@/ui/load-state";
import { TabPanel, Tabs, initialTab, useVisibleTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { WarrantyTimeline } from "@/ui/warranty-timeline";
import { VaultPanel } from "@/ui/vault-panel";
import { useToast } from "@/ui/toast";
import { useCatalogLists } from "@/ui/use-catalog-lists";
import { DeviceLicensesExpand } from "@/features/software/device-licenses-expand";
import { DeviceIpAssign } from "@/features/ipam/device-ip-assign";
import { RowActions } from "@/ui/row-actions";
import { useIsNarrow } from "@/ui/use-narrow";
import { heldSummary, warrantyNudgeEnd } from "./device-glance";
import { deviceMenuItems } from "./device-actions";
import { DeviceForm } from "./device-form";
import { toHistoryEntries } from "./device-history-entries";
import {
  mergeDeviceTimeline,
  TIMELINE_FILTER_KEY,
  TIMELINE_FILTERS,
  type DeviceTimeline,
  type TimelineFilter,
} from "./device-timeline";

/** Trần dòng mỗi nguồn — khớp `HISTORY_PAGE_LIMIT` phía API (trần kỹ thuật, không phải AD-11). */
const HISTORY_CAP = 200;
import { PortMapPanel, type PortMap } from "./port-map-panel";
import { RelationMap, type RelationNode } from "./relation-map";
import { RetireDialog, type RetireGroup } from "./retire-dialog";
import { StatusDialog } from "./status-dialog";
import {
  STATUS_KEY,
  STATUS_TONE,
  type DeviceHistoryRow,
  type DeviceRow,
  type DeviceStatus,
} from "@/lib/device-types";
import { PATHS } from "@/lib/routes";

type HeldKey = "ipam" | "ports" | "nat" | "isp" | "software" | "vault" | "attachments";

/** Khóa dịch viết ĐỦ chữ (không ghép chuỗi): bài `dead-keys-rollcall` tìm khóa theo chữ. */
const HELD_LABEL: Record<HeldKey, string> = {
  ipam: "devices.held.ipam",
  ports: "devices.held.ports",
  nat: "devices.held.nat",
  isp: "devices.held.isp",
  software: "devices.held.software",
  vault: "devices.held.vault",
  attachments: "devices.held.attachments",
};

/** Khu mở rộng do module khác đóng góp (IP, license, secret…) — có thể rỗng. */
interface DevicePanel {
  key: string;
  title: string;
  items: { label: string; value: string; link?: string; tone?: string }[];
  emptyText?: string;
}

/**
 * Trang chi tiết thiết bị tổng hợp (FR-001/002/006/007).
 *
 * Mở một trang thấy đủ: hồ sơ, tình trạng bảo hành, port map, giấy tờ, lịch sử.
 * Các khu IP · license · secret · phiếu đến từ `/devices/:id/panels` — module nào đăng ký
 * thì hiện, chưa có thì mảng rỗng và trang ẩn gọn, KHÔNG lỗi, không phụ thuộc tương lai.
 */
export function DeviceDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const lists = useCatalogLists();
  const queryClient = useQueryClient();
  const narrow = useIsNarrow();
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(() =>
    initialTab(params.get("tab"), [
      "profile",
      "ports",
      "attachments",
      "vault",
      "history",
    ]),
  );
  const [editing, setEditing] = useState(false);
  const [assigningIp, setAssigningIp] = useState(false);
  const [cloning, setCloning] = useState(false);
  /** Hộp đổi trạng thái nhanh — cũng là hộp mở lại hồ sơ đã thanh lý. */
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  /* `?action=retire` là lối từ menu ⋮ của danh sách: hộp thanh lý cần đọc các khu mà chỉ trang
     này có, nên danh sách chuyển sang đây và hộp mở sẵn. Máy đã thanh lý thì bỏ qua (xem chỗ
     vẽ hộp). */
  const [retiring, setRetiring] = useState(() => params.get("action") === "retire");
  /** Danh sách API trả kèm 409 `DEVICE_HAS_HOLDINGS` — mở lại hộp với đúng những thứ vướng. */
  const [retireBlocked, setRetireBlocked] = useState<string[] | null>(null);
  /** Đếm lượt bị chặn: mỗi lần 409 là một `key` mới, kể cả lần thứ hai liên tiếp. */
  const [retireRound, setRetireRound] = useState(0);
  const [retireError, setRetireError] = useState<string | null>(null);
  /** Khu chi tiết (IP, NAT, đường truyền, license) người dùng đã thu gọn ở tab Tổng quan. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleZone = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const device = useQuery({
    queryKey: ["devices", id],
    queryFn: () => apiFetch<DeviceRow>(`/api/v1/devices/${id}`),
    retry: false,
  });

  const panels = useQuery({
    queryKey: ["devices", id, "panels"],
    queryFn: () => apiFetch<DevicePanel[]>(`/api/v1/devices/${id}/panels`),
    enabled: device.isSuccess,
  });

  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("");
  /* Sự kiện của module khác (IP, license) — chỉ cần khi mở tab Lịch sử. */
  const timeline = useQuery({
    queryKey: ["devices", id, "timeline"],
    queryFn: () => apiFetch<DeviceTimeline>(`/api/v1/devices/${id}/timeline`),
    enabled: device.isSuccess && tab === "history",
  });

  const history = useQuery({
    queryKey: ["devices", id, "history"],
    queryFn: () =>
      apiFetch<DeviceHistoryRow[]>(`/api/v1/devices/${id}/history`),
    /* Hỏi luôn, không chờ mở tab: "đang ở trạng thái này TỪ KHI NÀO", "thanh lý ngày nào, ai
       làm" và "ai sửa lần cuối" đều đọc từ đây — lấy ngày mua thay vào là nói sai. */
    enabled: device.isSuccess,
  });

  /*
   * Đếm cổng cho huy hiệu trên tab Port map.
   *
   * Thiếu số thì tab DÀY nhất lại là tab duy nhất trông như rỗng — người đọc suy "không có số
   * nghĩa là không có gì".
   *
   * Dùng ĐÚNG `queryKey` của `PortMapPanel` nên đây không phải lượt gọi thứ hai: bấm sang tab
   * là dữ liệu đã nằm sẵn trong cache, tab mở ra không còn quay vòng chờ.
   */
  /*
   * HỎI CỔNG CHO MỌI MÁY, không chỉ máy có port map.
   *
   * Tắt lượt gọi này khi loại thiết bị không bật `has_port_map` nghe hợp lý — máy in thì không
   * có bảng cổng. Nhưng `/ports` trả về HAI chiều: cổng của chính máy này, VÀ cổng của máy
   * khác đang đấu vào nó. Chiều thứ hai chính là chiều mà một cái máy trạm có: nó không có
   * cổng nào để khai, nhưng ba con switch đang cắm vào nó.
   *
   * Tắt đi thì hỏng hai chỗ: bản đồ quan hệ thiếu hẳn một nhánh, và quan trọng hơn, lượt xem
   * "thanh lý sẽ cắt gì" nói thiếu — trong khi `port-device-retirement.ts` sẽ gỡ đúng những
   * liên kết ấy. Tức là màn hình hứa ít hơn việc thật sự xảy ra.
   *
   * FR-006 vẫn nguyên: cái nó cấm là bày một BẢNG CỔNG rỗng cho máy in, và điều đó do danh
   * sách tab bên dưới quyết định, không phải do bịt lượt gọi này.
   */
  const ports = useQuery({
    queryKey: ["devices", id, "ports"],
    queryFn: () => apiFetch<PortMap>(`/api/v1/devices/${id}/ports`),
  });

  const setStatus = useApiMutation<{ status: string; cleanup?: boolean }, unknown>(
    `/api/v1/devices/${id}/status`,
    { method: "PATCH", csrfToken: me.csrfToken, refreshMe: false },
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["devices"] });

  /**
   * Tab Két sắt hiện cho MỌI vai.
   *
   * Member có thể được whitelist hoặc xin duyệt, và quyền đó nằm ở ma trận quyền xem secret
   * (FR-023) — client không tự suy ra được từ vai. Ẩn tab theo vai thì người đã được gán
   * quyền lại không có đường nào tới. Panel tự nói rõ tầng của người xem.
   */
  const canVault = true;

  /*
   * Danh sách tab dựng TRƯỚC mấy nhánh `return` sớm bên dưới, vì `useVisibleTab` là hook:
   * đặt nó sau `if (device.isLoading) return` thì số hook giữa hai lượt render lệch nhau.
   * Lúc hồ sơ chưa về thì chỉ có Hồ sơ + Giấy tờ + Lịch sử, nhưng cũng chưa vẽ gì.
   */
  const counts = useTabCounts("device", id, me);
  /* Số trên tab = số DÒNG tab đó bày ra, và tab Port map bày cả hai chiều (AD-14: một sợi dây
     một bản ghi, nhìn từ đầu nào cũng phải thấy). */
  const portRowCount =
    (ports.data?.ports.length ?? 0) + (ports.data?.incoming.length ?? 0);
  const tabItems = [
    { key: "profile", label: t("devices.tabProfile") },
    /*
     * Tab Port map hiện khi loại máy có port (FR-006) — HOẶC khi thật sự có dòng để bày.
     *
     * Vế sau là cho cái máy trạm bị ba con switch cắm vào: nó không có cổng nào của riêng
     * mình, nhưng "ai đang cắm vào tôi" là câu có thật và không có chỗ nào khác trả lời.
     * Điều FR-006 cấm — bày một bảng RỖNG cho máy in — vẫn được giữ nguyên: máy in không có
     * dòng nào thì cả hai vế đều sai và tab vẫn không mọc ra.
     */
    /*
     * Vế thứ ba (`ports.isError`): CHƯA ĐỌC ĐƯỢC thì tab phải ở lại.
     *
     * `ports.data?.ports.length ?? 0` biến một lỗi 500 thành số 0, nên với máy không bật
     * `has_port_map` cả hai vế đầu đều sai và TAB BIẾN MẤT HẲN — người dùng kết luận máy này
     * không có gì để xem, trong khi sự thật là lượt gọi vừa hỏng. Giữ tab lại thì
     * `PortMapPanel` tự bày lỗi của nó và có nút thử lại.
     */
    /*
     * `ports.isPending` cũng phải giữ tab lại.
     *
     * `useVisibleTab` bên dưới kẹp `tab` về `'profile'` khi khoá hiện tại không có trong danh
     * sách này — và nó chạy NGAY ở lượt render đầu, lúc `device.data` còn `undefined` và
     * `portRowCount` là 0. Nên mở thẳng `/devices/<id>?tab=ports` (link dán cho đồng nghiệp,
     * hoặc F5 khi đang đứng ở tab Cổng) thì tab chưa kịp mọc đã bị kẹp về Tổng quan; dữ liệu
     * về sau đó, tab mọc lại, nhưng `tab` đã bị đổi rồi — link sâu mất vĩnh viễn.
     */
    ...(device.data?.hasPortMap || portRowCount > 0 || ports.isError || ports.isPending
      ? [
          {
            key: "ports",
            label: t("devices.tabPortMap"),
            // Chưa đọc được thì không có số nào để nói — `undefined`, không phải 0.
            count: ports.isError || ports.isPending ? undefined : portRowCount,
          },
        ]
      : []),
    {
      key: "attachments",
      label: t("devices.tabAttachments"),
      count: counts.files,
    },
    // Két sắt chỉ hiện với người có quyền — Member không có đường tới endpoint (AD-9),
    // hiện tab rồi báo 403 chỉ tổ làm người ta tưởng hệ thống hỏng.
    ...(canVault
      ? [{ key: "vault", label: t("vault.tab"), count: counts.secrets }]
      : []),
    { key: "history", label: t("devices.tabHistory") },
  ];
  const safeTab = useVisibleTab(
    tab,
    tabItems.map((entry) => entry.key),
    setTab,
  );

  if (device.isLoading) return <Loading />;
  if (device.isError) {
    // 404 = thiết bị không tồn tại → khối "không tìm thấy hồ sơ" có nút về danh sách, không phải
    // khối lỗi đỏ "thử lại"; lỗi khác thì Thử lại. Cả hai giữ đường lùi về danh sách.
    return (
      <DetailLoadFailed
        error={device.error}
        onRetry={() => void device.refetch()}
        backTo={PATHS.devices}
        backLabel={t("nav.devices")}
      />
    );
  }

  /*
   * `!device.data` chứ KHÔNG phải `device.data!`.
   *
   * `lib/api-client.ts` không khai `networkMode`, nên TanStack v5 chạy mặc định `'online'`:
   * mất mạng ⇒ `fetchStatus: 'paused'` ⇒ `isFetching === false` ⇒ **`isLoading === false`**,
   * mà `isError` cũng false và `data` là `undefined`. Cả hai nhánh thoát bên trên đều trượt,
   * rồi dòng dưới đọc `item.status` và ném `TypeError`. ErrorBoundary của shell sẽ bắt được,
   * nhưng người dùng nên thấy "đang tải" chứ không phải khối báo lỗi.
   */
  if (!device.data) return <Loading />;
  const item = device.data;
  const retired = item.status === "retired";
  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày ra nút để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";
  /** Khu do module `software` đăng ký — tách riêng vì nó có bảng riêng, không dùng khu chung. */
  const softwarePanel = (panels.data ?? []).find(
    (panel) => panel.key === "software",
  );

  /* =====================================================================
   * BẢN ĐỒ QUAN HỆ — dựng từ ĐÚNG thứ API đã trả, không thêm endpoint nào.
   *
   * Nút nào có tab riêng thì bấm là CHUYỂN TAB (cổng, két sắt, giấy tờ); nút nào là một thẻ
   * ngay dưới bản đồ thì bấm là nhảy tới thẻ đó rồi nháy một cái. Một mô hình điều hướng,
   * không phải hai.
   * ===================================================================== */
  /* Chuyển xong thì dời TIÊU ĐIỂM tới đích: chỉ cuộn thì người dùng bàn phím / trình đọc màn
     hình vẫn đứng ở nút cũ và không biết nội dung đã đổi. */
  const goTab = (key: string) => {
    setTab(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
      panel?.setAttribute("tabindex", "-1");
      panel?.focus({ preventScroll: true });
    });
  };
  const goSection = (key: string) => {
    // Bấm từ bản đồ / chip là muốn XEM khu đó — đang thu gọn thì mở ra trước.
    setFolded((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    const el = document.getElementById(`sec-${key}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
    el.classList.remove("sec-flash");
    // Ép trình duyệt tính lại layout để animation chạy lại cho lần bấm thứ hai.
    void el.offsetWidth;
    el.classList.add("sec-flash");
  };

  const panelOf = (key: string) =>
    (panels.data ?? []).find((panel) => panel.key === key);

  /** Khu quan hệ vẽ được: có panel VÀ panel có dòng. `tone` của item chính là cảnh báo. */
  const relationFromPanel = (
    key: string,
    icon: RelationNode["icon"],
    cut: boolean,
    onOpen: () => void,
    preview = true,
  ): RelationNode | null => {
    const panel = panelOf(key);
    if (!panel || panel.items.length === 0) return null;
    return {
      key,
      title: panel.title,
      count: panel.items.length,
      icon,
      cut,
      onOpen,
      lines: (preview ? panel.items.slice(0, 2) : []).map((entry) => ({
        text: `${entry.label} · ${entry.value}`,
        tone: entry.tone === "warn" || entry.tone === "danger" ? entry.tone : undefined,
      })),
    };
  };

  const ownPorts = ports.data?.ports ?? [];
  const incomingPorts = ports.data?.incoming ?? [];
  const relationNodes: RelationNode[] = [
    ownPorts.length > 0
      ? {
          key: "ports",
          title: t("relationMap.ownPorts"),
          count: ownPorts.length,
          icon: "port" as const,
          // Cổng của CHÍNH máy này được GIỮ khi thanh lý — `port-device-retirement.ts` nói rõ:
          // sơ đồ đấu nối của một máy đã thanh lý vẫn là hồ sơ của nó.
          cut: false,
          onOpen: () => goTab("ports"),
          lines: [
            {
              text: ownPorts.slice(0, 3).map((port) => port.portLabel).join(" · "),
              mono: true,
            },
          ],
        }
      : null,
    incomingPorts.length > 0
      ? {
          key: "incoming",
          title: t("relationMap.incomingPorts"),
          count: incomingPorts.length,
          icon: "arrow" as const,
          // Cổng trên máy KHÁC trỏ vào máy này thì BỊ gỡ liên kết (giữ lại chữ, không thành ô trắng).
          cut: true,
          onOpen: () => goTab("ports"),
          lines: [
            {
              text: incomingPorts
                .slice(0, 2)
                .map((row) => `${row.deviceCode} · ${row.portLabel}`)
                .join(" · "),
              mono: true,
            },
          ],
        }
      : null,
    /* IP không xem trước trên nút: địa chỉ đầu đã ở "IP quản trị" của Thông tin nhanh, cả
       danh sách ở khu Địa chỉ IP ngay dưới — in thêm lần thứ ba ở đây là nhiễu. */
    relationFromPanel("ipam", "ip", true, () => goSection("ipam"), false),
    relationFromPanel("nat", "arrow", true, () => goSection("nat")),
    relationFromPanel("isp", "globe", true, () => goSection("isp")),
    relationFromPanel("software", "lic", true, () => goSection("software")),
    relationFromPanel("vault", "lock", false, () => goTab("vault")),
    // `counts.files` có thể là `undefined` ("chưa biết") — phép thử truthy gộp nó với 0, và
    // ở ĐÂY thì gộp đúng: chưa biết cũng như chưa có, đều không vẽ nút. Chỗ phân biệt hai
    // nghĩa là dòng "Chưa gắn" bên dưới.
    counts.files
      ? {
          key: "attachments",
          title: t("relationMap.attachments"),
          count: counts.files,
          icon: "doc" as const,
          cut: false,
          onOpen: () => goTab("attachments"),
          lines: [],
        }
      : null,
  ].filter((node): node is RelationNode => node !== null);

  /**
   * Khu KHÔNG có gì — gom về một dòng xám, không vẽ ô rỗng (cùng lối `BlankFields`).
   *
   * BA TRẠNG THÁI, KHÔNG PHẢI HAI. Mỗi khu có thể ở một trong ba tình huống:
   *   · CÓ dòng            → vẽ nút trên bản đồ;
   *   · KHÔNG có dòng      → kể tên vào dòng "Chưa gắn";
   *   · CHƯA BIẾT          → không được nói gì cả.
   *
   * Hai lỗi cùng họ phải tránh:
   *
   * 1. Đọc `counts.files` bằng phép thử truthy, trong khi `ui/tab-counts.ts` khai rõ
   *    `undefined` = "chưa biết (đang tải, hoặc không có quyền xem), KHÔNG phải 0". Một hồ sơ
   *    có 4 giấy tờ mà `/attachments` chưa về sẽ bị khẳng định là "Chưa gắn: Giấy tờ".
   *
   * 2. Vẽ nút theo `panel.items.length > 0` nhưng dòng "Chưa gắn" lại theo `panelOf(key)` —
   *    hai vị từ khác nhau cho cùng một câu hỏi. Module `ipam` đăng ký panel nhưng máy chưa
   *    có IP nào → panel TỒN TẠI, `items` rỗng → không có nút, cũng KHÔNG có tên trong dòng
   *    "Chưa gắn". Khu đó tàng hình: người đọc không phân biệt được với "module chưa deploy".
   */
  /**
   * `looksAbsent` trả `true` khi panel KHÔNG tồn tại hoặc RỖNG — tức khi khu ấy trông như
   * không có gì. Tên nói đúng chiều của giá trị; một tên kiểu `moduleEnabled` thì phải đọc
   * ngược lại trong đầu, mỗi lần.
   */
  const looksAbsent = (key: string): boolean => {
    const panel = panelOf(key);
    // Chưa đọc được sổ khu mở rộng → chưa biết, `isUnknown` của bản đồ đã lo phần nói năng.
    if (!panels.data) return false;
    // Panel không tồn tại (module chưa deploy) HOẶC tồn tại mà rỗng — với người đọc là một.
    return !panel || panel.items.length === 0;
  };

  const relationMissing = [
    device.data?.hasPortMap && ownPorts.length === 0 ? t("devices.tabPortMap") : null,
    looksAbsent("ipam") ? t("nav.ipam") : null,
    looksAbsent("nat") ? t("nav.nat") : null,
    looksAbsent("isp") ? t("nav.isp") : null,
    looksAbsent("software") ? t("nav.software") : null,
    looksAbsent("vault") ? t("vault.tab") : null,
    counts.files === undefined ? null : counts.files === 0 ? t("devices.tabAttachments") : null,
  ].filter((label): label is string => label !== null);

  /* Hộp Thanh lý đọc CÙNG nguồn với bản đồ, liệt kê từng dòng thật — không hứa gỡ một thứ
     máy không giữ. Nhóm "sẽ gỡ" bám theo các file `*-device-retirement.ts` bên API: cổng của
     máy KHÁC đang cắm vào, IP, rule NAT, đường truyền, ghế license. */
  const panelLines = (key: string) =>
    (panelOf(key)?.items ?? []).map((entry) => `${entry.label} · ${entry.value}`);
  const retireCut: RetireGroup[] = [
    {
      title: t("relationMap.incomingPorts"),
      items: incomingPorts.map((row) => `${row.deviceCode} · ${row.portLabel}`),
    },
    ...["ipam", "nat", "isp", "software"].map((key) => ({
      title: panelOf(key)?.title ?? key,
      items: panelLines(key),
    })),
  ];
  const retireKeep = [
    ownPorts.length > 0 ? t("devices.retireKeepPorts", { count: ownPorts.length }) : null,
    counts.secrets ? t("devices.retireKeepVault", { count: counts.secrets }) : null,
    counts.files ? t("devices.retireKeepFiles", { count: counts.files }) : null,
    t("devices.retireKeepHistory"),
  ].filter((entry): entry is string => entry !== null);

  /* Lịch sử API trả MỚI NHẤT trước. "Từ ngày …" của trạng thái là lượt đổi trạng thái gần nhất
     — không phải ngày mua: "Hỏng từ <ngày mua>" là sai nghĩa. Chưa đổi lần nào thì không nói. */
  const historyRows = history.data ?? [];
  const lastStatusChange = historyRows.find((row) => row.action === "status-changed");
  const lastRetire = retired ? lastStatusChange : undefined;
  const lastEdit = historyRows[0];
  const retireCleaned = lastRetire?.changes?.cleanup?.after === true;

  /* IP quản trị = IP đầu tiên do module `ipam` khai cho máy này (nhãn của dòng là địa chỉ). */
  const firstIp = panelOf("ipam")?.items[0]?.label ?? null;
  const vendor = (lists.data?.vendors ?? []).find((entry) => entry.id === item.vendorId);

  const blankLabels = [
    item.model ? null : t("devices.model"),
    item.serial ? null : t("devices.serial"),
    item.vendorName ? null : t("devices.vendor"),
    item.department ? null : t("devices.department"),
    item.purchaseDate ? null : t("devices.purchaseDate"),
    item.note ? null : t("devices.note"),
  ].filter((label): label is string => label !== null);

  const openStatus = () => {
    setStatusError(null);
    setStatusOpen(true);
  };
  /* Gỡ `?action=retire` khi đóng hộp: để lại thì F5 hay Back về trang này lại bật hộp thanh lý. */
  const closeRetire = () => {
    setRetiring(false);
    if (params.has("action")) {
      setParams(
        (next) => {
          next.delete("action");
          return next;
        },
        { replace: true },
      );
    }
  };
  const openRetire = () => {
    setRetireBlocked(null);
    setRetireError(null);
    setRetiring(true);
  };

  const nudgeEnd = warrantyNudgeEnd(item.status, item.warrantyEnd);
  /* Hàng "Đang giữ" (chỉ trên điện thoại, thay bản đồ quan hệ): đếm từ đúng nguồn của bản đồ,
     bấm là tới khu/tab đó — cả bộ con số trong một dòng thay cho một danh sách nút cao. */
  const held = heldSummary<HeldKey>([
    { key: "ipam", count: panels.data ? (panelOf("ipam")?.items.length ?? 0) : undefined },
    { key: "ports", count: ports.data ? portRowCount : undefined },
    { key: "nat", count: panels.data ? (panelOf("nat")?.items.length ?? 0) : undefined },
    { key: "isp", count: panels.data ? (panelOf("isp")?.items.length ?? 0) : undefined },
    { key: "software", count: panels.data ? (panelOf("software")?.items.length ?? 0) : undefined },
    { key: "vault", count: counts.secrets },
    { key: "attachments", count: counts.files },
  ]);
  const heldTarget: Record<HeldKey, () => void> = {
    ipam: () => goSection("ipam"),
    ports: () => goTab("ports"),
    nat: () => goSection("nat"),
    isp: () => goSection("isp"),
    software: () => goSection("software"),
    vault: () => goTab("vault"),
    attachments: () => goTab("attachments"),
  };

  const changeStatus = (status: DeviceStatus) => {
    setStatusError(null);
    setStatus.mutate(
      { status },
      {
        onSuccess: () => {
          setStatusOpen(false);
          toast({ message: t("devices.statusChanged") });
          void refresh();
        },
        onError: (err) => setStatusError(errorMessage(err)),
      },
    );
  };

  return (
    <>
      <DetailHeader
        crumbs={[
          { label: t("nav.devices"), to: PATHS.devices },
          { label: item.deviceTypeName },
          { label: item.code },
        ]}
        code={item.code}
        name={item.name}
        /* Dòng định danh: không in lại loại (đã ở breadcrumb) hay model (ở Thông tin nhanh).
           Serial có nút chép (dán vào terminal/phiếu bảo hành). Mã thì KHÔNG: nó là tiêu đề
           trang, bôi đen chép được, và `DetailHeader` đã bỏ nút chép mã ở mọi trang chi tiết. */
        subline={
          item.serial ? (
            <span className="subline-item">
              S/N <span className="mono">{item.serial}</span>
              <CopyButton value={item.serial} label={t("devices.copySerial")} />
            </span>
          ) : undefined
        }
        actions={
          narrow ? (
            /* Điện thoại: đứng trước tủ, việc cần là két (mật khẩu) — không phải Sửa/Thanh lý.
               Nút chính đưa thẳng tới tab Két sắt; mọi việc sửa hồ sơ vào menu ⋯. Máy đã
               thanh lý thì "Mở lại" vẫn là nút chính như trên máy tính. */
            <>
              {retired ? (
                <button type="button" className="btn primary" onClick={openStatus}>
                  {t("devices.reopen")}
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => goTab("vault")}>
                  {t("devices.openVault")}
                </button>
              )}
              <RowActions
                label={t("common.actionsOf", { subject: item.code })}
                subject={item.code}
                items={deviceMenuItems(t, retired, {
                  onEdit: () => setEditing(true),
                  onStatus: openStatus,
                  onClone: () => setCloning(true),
                  onRetire: openRetire,
                })}
              />
            </>
          ) : retired ? (
            /* Hồ sơ đã khoá: việc làm được DUY NHẤT là mở lại, nên nó là nút chính. Nút "Sửa hồ
               sơ" xám ở chỗ mắt tìm nút chính chỉ là một lời hứa không bấm được. */
            <>
              <button type="button" className="btn primary" onClick={openStatus}>
                {t("devices.reopen")}
              </button>
              <button type="button" className="btn ghost" onClick={() => setCloning(true)}>
                {t("devices.clone")}
              </button>
            </>
          ) : (
            <>
              {/* Q-18: "Sửa hồ sơ" là nút chính đứng ngoài; Đổi trạng thái · Nhân bản · Thanh lý
                  vào ⋮ — cùng bộ việc với dòng máy ở danh sách (`deviceMenuItems`). */}
              <button type="button" className="btn primary" onClick={() => setEditing(true)}>
                {t("devices.edit")}
              </button>
              <RowActions
                label={t("common.actionsOf", { subject: item.code })}
                subject={item.code}
                items={deviceMenuItems(t, retired, {
                  onStatus: openStatus,
                  onClone: () => setCloning(true),
                  onRetire: openRetire,
                })}
              />
            </>
          )
        }
      />

      {/* Băng đã thanh lý: nói KHI NÀO, AI, và đã gỡ gì ngay đầu trang — không bắt người đọc
          lục tab Lịch sử. Có nền, có viền: chữ xám trơn thụt lề thì người ta đọc lướt qua. */}
      {retired ? (
        <div className="alert warn retired-banner" role="status">
          <strong>{t("devices.retiredLocked")}</strong>
          {lastRetire ? (
            <span>
              {t("devices.retiredBy", {
                date: formatDateTime(lastRetire.createdAt),
                actor: lastRetire.actor,
              })}
              {retireCleaned ? ` · ${t("devices.retiredCleaned")}` : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Máy Hỏng mà còn bảo hành: bước kế tiếp là gọi NCC, không phải tự sửa hay mua mới.
          Tên và số điện thoại NCC KHÔNG in lại ở đây — dòng "Nhà cung cấp" của thẻ định danh
          ngay bên cạnh đã có cả hai, bấm gọi được. */}
      {nudgeEnd ? (
        <p className="alert info" role="note">
          {t("devices.warrantyNudge", { date: formatDate(nudgeEnd) })}
        </p>
      ) : null}

      <DetailLayout
        railStrip={safeTab !== "profile"}
        railSummary={
          <>
            <span className={`badge ${STATUS_TONE[item.status]}`}>
              {t(STATUS_KEY[item.status])}
            </span>
            {item.siteCode ? <LocationText device={item} /> : null}
            {item.assignedTo ? <span>{item.assignedTo}</span> : null}
            <ExpiryBadge end={item.warrantyEnd} notCounted={retired} />
          </>
        }
        rail={
          <RailCard title={t("devices.summaryCard")}>
            <RailRow
              label={t("devices.status")}
              note={
                lastStatusChange
                  ? t("devices.since", { date: formatDate(lastStatusChange.createdAt) })
                  : undefined
              }
            >
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </RailRow>
            {/* KHÔNG kèm `note={cabinetCode}`: `LocationText` đã ghép sẵn "LST · T-1", nên
                dòng chú bên dưới in lại đúng mã tủ ấy lần thứ hai trong cùng một ô. */}
            <RailRow label={t("devices.locationCol")}>
              <LocationText device={item} />
            </RailRow>
            {/*
              BỘ PHẬN KHÔNG ĐƯỢC BIẾN MẤT CÙNG NGƯỜI DÙNG (18/09/2026).
              `department` chỉ sống dưới dạng CHÚ của dòng này, mà `RailRowIfSet` ẩn cả dòng
              khi `assignedTo` rỗng — nên một máy đã gán cho phòng Kế toán nhưng chưa ghi tên
              người cụ thể thì không hiện bộ phận ở đâu cả, và `BlankFields` cũng bỏ qua vì
              `item.department` CÓ giá trị. Chưa có người thì bộ phận đứng thành dòng RIÊNG,
              mang đúng nhãn của nó — chứ không phải một dòng "Người dùng" trống kèm chú.
            */}
            {item.assignedTo ? (
              <RailRowIfSet
                label={t("devices.assignedTo")}
                value={item.assignedTo}
                note={item.department ?? undefined}
              />
            ) : (
              <RailRowIfSet label={t("devices.department")} value={item.department} />
            )}
            {/*
             * THANH HẠN NẰM Ở ĐÂY, KHÔNG Ở CỘT CHÍNH.
             *
             * Một thẻ "Bảo hành" chiếm trọn bề ngang ở tab Hồ sơ chỉ in lại đúng ba con số mà
             * dải chỉ số đã có (còn N ngày, đến ngày nào, nhà cung cấp) — hai chỗ cách nhau
             * 40px. Và một thanh tiến độ kéo dài 1150px thì phần kéo dài ấy không nói thêm gì
             * cả. Hạn là TRẠNG THÁI của hồ sơ nên nó thuộc về thẻ định danh.
             *
             * Vẫn là `WarrantyTimeline` ĐẦY ĐỦ chứ không phải bản `compact`: bản gọn giấu hai
             * mốc ngày và dòng "Đã đi N%", mà đó là những thứ thanh này sinh ra để nói.
             */}
            <RailRow label={t("devices.warranty")} wide>
              {item.warrantyEnd ? (
                <WarrantyTimeline
                  notCounted={retired}
                  start={item.warrantyStart ?? item.purchaseDate}
                  end={item.warrantyEnd}
                  startLabel={
                    item.warrantyStart
                      ? t("devices.warrantyStart")
                      : t("devices.purchaseDate")
                  }
                  endLabel={t("devices.warrantyEnd")}
                />
              ) : (
                <ExpiryBadge end={null} />
              )}
            </RailRow>
            {/* NCC kèm số điện thoại và người liên hệ từ danh mục: máy hỏng mà còn bảo hành thì
                việc kế tiếp là gọi NCC — đừng bắt người dùng sang màn Danh mục tra số. */}
            {item.vendorName ? (
              <RailRow
                label={t("devices.vendor")}
                note={
                  vendor?.phone || vendor?.contact ? (
                    <>
                      {vendor.contact ? <span>{vendor.contact}</span> : null}
                      {vendor.contact && vendor.phone ? " · " : null}
                      {vendor.phone ? (
                        <a href={`tel:${vendor.phone.replace(/[^\d+]/g, "")}`}>{vendor.phone}</a>
                      ) : null}
                    </>
                  ) : undefined
                }
              >
                {item.vendorName}
              </RailRow>
            ) : null}
            <RailRowIfSet
              label={t("devices.purchaseDate")}
              value={formatDate(item.purchaseDate)}
            />
            {/* Hồ sơ cũ hay mới — người đọc cần biết trước khi tin số liệu. */}
            <p className="rail-foot">
              {t("devices.createdAt", { date: formatDate(item.createdAt) })}
              {lastEdit
                ? ` · ${t("devices.lastEditBy", {
                    date: formatDate(lastEdit.createdAt),
                    actor: lastEdit.actor,
                  })}`
                : null}
            </p>
          </RailCard>
        }
      >
        <Tabs
          items={tabItems}
          value={safeTab}
          onChange={setTab}
          ariaLabel={t("devices.title")}
        />

        <TabPanel tabKey={safeTab}>
        {safeTab === "profile" ? (
          <>
            {/*
              THÔNG TIN NHANH đứng ĐẦU tab: mở máy ra, câu hỏi đầu tiên là IP quản trị và
              model, nên chúng không được nằm cuối trang hay sau bản đồ quan hệ. Trạng
              thái, vị trí, người dùng, bảo hành đã ở cột Tóm tắt, serial ở dòng dưới tiêu đề (có
              nút chép) — nên không in lại ở đây.
            */}
            <DetailSection title={t("devices.quickInfo")} compact>
              <dl className="data-grid">
                <DataItemIfSet label={t("devices.managementIp")} value={firstIp}>
                  <span className="mono">{firstIp}</span>
                  {firstIp ? <CopyButton value={firstIp} label={t("devices.copyIp")} /> : null}
                </DataItemIfSet>
                <DataItemIfSet label={t("devices.model")} value={item.model} />
                <DataItemIfSet label={t("devices.note")} value={item.note} />
              </dl>
              {/* MỘT bản "máy đang giữ gì" cho mỗi khổ: máy tính có bản đồ quan hệ ngay dưới
                  (đếm + xem trước từng khu), điện thoại thì hàng chip này thay cho bản đồ. Vẽ
                  cả hai là cùng bộ con số hai lần cách nhau một khung. */}
              {narrow && held.length > 0 ? (
                <div className="chip-row" role="group" aria-label={t("devices.heldLabel")}>
                  <span className="muted small">{t("devices.heldLabel")}</span>
                  {held.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className="btn sm ghost"
                      onClick={heldTarget[entry.key]}
                    >
                      {t(HELD_LABEL[entry.key], { count: entry.count })}
                    </button>
                  ))}
                </div>
              ) : null}
              {/* Ô chưa khai gom về MỘT dòng, kèm lối đi bổ sung ngay — một dòng chữ xám không
                  dẫn tới đâu thì chẳng ai bổ sung. */}
              <BlankFields labels={blankLabels} />
              {!retired ? (
                <div className="row" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
                  {blankLabels.length > 0 ? (
                    <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}>
                      {t("devices.fillBlanks", { count: blankLabels.length })}
                    </button>
                  ) : null}
                  {/* Cấp IP ngay tại đây: không thì phải sang màn Địa chỉ IP, chọn dải, lật
                      trang tìm ô trống rồi gõ lại mã máy này. */}
                  <button type="button" className="btn sm ghost" onClick={() => setAssigningIp(true)}>
                    {t("devices.assignIp")}
                  </button>
                </div>
              ) : null}
            </DetailSection>

            {narrow ? null : (
            <RelationMap
              retired={retired}
              hubCode={item.code}
              nodes={relationNodes}
              missing={relationMissing}
              /* Hai nguồn nuôi bản đồ: khu mở rộng (`/panels`) và cổng (`/ports`). Bất kỳ cái
                 nào chưa về hoặc hỏng thì bản đồ CHƯA BIẾT — không được nói "chưa giữ gì".
                 `counts` (giấy tờ, két) là nguồn thứ ba nhưng nó tự phân biệt được
                 `undefined` với 0, nên xử riêng ở `relationNodes`/`relationMissing`. */
              isUnknown={
                panels.isError || panels.isPending || ports.isError || ports.isPending
              }
              /* Tách "đang tải" khỏi "hỏng": cả hai đều là CHƯA BIẾT, nhưng chỉ cái sau xứng
                 một lời cảnh báo. Xem chú thích prop `isLoading`. */
              isLoading={
                !panels.isError && !ports.isError && (panels.isPending || ports.isPending)
              }
            />
            )}

            {/* Phần mềm đang cài dùng BẢNG GHẾ đầy đủ (kỳ hạn · chi phí · hợp đồng), không
                phải khu `nhãn: giá trị` chung — cùng một bảng với khu bung dòng ở danh sách
                thiết bị, nên hai chỗ không thể trả lời khác nhau (AD-15).

                Tiêu đề lấy từ CHÍNH `panel.title` của API, không tự đặt một chuỗi thứ hai:
                module `software` là chủ sở hữu khu này (nó tự đăng ký vào sổ của `devices`),
                nên nó cũng là nơi quyết định khu ấy tên gì. Đặt tên riêng ở đây là để hai
                chỗ trôi lệch nhau, và bài kiểm e2e đã bắt đúng lúc chúng bắt đầu lệch. */}
            {softwarePanel ? (
              <ZoneSection
                zoneKey="software"
                title={`${softwarePanel.title} (${softwarePanel.items.length})`}
                open={!folded.has("software")}
                onToggle={() => toggleZone("software")}
              >
                <DeviceLicensesExpand deviceId={item.id} showHeader={false} />
              </ZoneSection>
            ) : null}

            {/*
              KHU MỞ RỘNG HỎNG PHẢI NÓI RA, KHÔNG ĐƯỢC BIẾN MẤT.
              `(panels.data ?? [])` biến một lỗi 500 thành "máy này không giữ gì cả" — và
              trang vẫn trông hoàn chỉnh, vì phần hồ sơ ở trên vẫn đầy đủ. Đúng câu hỏi người
              ta mở trang này ra để hỏi TRƯỚC KHI THANH LÝ: máy còn giữ IP, rule NAT, ghế
              license nào không. Đọc nhầm sự im lặng đó thành "sạch rồi" là thanh lý nhầm.
            */}
            {panels.isError ? (
              <div className="card device-panel">
                <LoadError error={panels.error} onRetry={() => void panels.refetch()} />
              </div>
            ) : (
              <ExtensionPanels
                /* Bỏ CẢ HAI khu khỏi cột chính:
                   - `software`: đã có bảng riêng ngay trên;
                   - `vault`: trang đã có hẳn một TAB "Két sắt", vẽ thêm một khu nữa ở đây là
                     cùng một dữ liệu ở hai chỗ cách nhau một cú bấm. Nút Két sắt trên bản đồ
                     chuyển thẳng sang tab đó. */
                panels={(panels.data ?? []).filter(
                  (panel) => panel.key !== "software" && panel.key !== "vault",
                )}
                folded={folded}
                onToggle={toggleZone}
              />
            )}
          </>
        ) : safeTab === "ports" ? (
          <PortMapPanel
            device={item}
            csrfToken={me.csrfToken}
            canEdit={!retired}
          />
        ) : safeTab === "vault" ? (
          <VaultPanel
            ownerType="device"
            ownerId={item.id}
            me={me}
            /* Ghi vào két là việc của SA/Admin. Member MỞ được tab nên phải chặn ở đây —
               không thì họ thấy "Cất secret"/"Xoay"/"Xóa" và bấm vào là 403. */
            canEdit={canVaultWrite && !retired}
            ownerLabel={item.code}
            locked={retired}
          />
        ) : safeTab === "attachments" ? (
          <AttachmentPanel
            ownerType="device"
            ownerId={item.id}
            csrfToken={me.csrfToken}
            /* Thiết bị đã thanh lý: hồ sơ khóa lại thì giấy tờ cũng chỉ còn đọc/tải. */
            canEdit={!retired}
          />
        ) : history.isLoading || timeline.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <>
            <div className="segmented" role="group" aria-label={t("devices.timelineFilter")}>
              {TIMELINE_FILTERS.map((key) => (
                <button
                  key={key || "all"}
                  type="button"
                  aria-pressed={timelineFilter === key}
                  onClick={() => setTimelineFilter(key)}
                >
                  {t(TIMELINE_FILTER_KEY[key])}
                </button>
              ))}
            </div>
            {/* Nguồn hỏng phải NÓI RA: im lặng thì đọc thành "máy chưa từng dùng IP/key nào". */}
            {timeline.isError || (timeline.data?.failedSources.length ?? 0) > 0 ? (
              <p className="alert" role="status">
                {t("devices.timelineFailed", {
                  sources: timeline.isError
                    ? `${t("devices.timelineIp")}, ${t("devices.timelineLicense")}`
                    : (timeline.data?.failedSources ?? [])
                        .map((source) =>
                          t(TIMELINE_FILTER_KEY[source as "ipam" | "software"] ?? source),
                        )
                        .join(", "),
                })}
              </p>
            ) : null}
            <AuditLogLink role={me.role} objectType="device" objectId={item.id} />
            <HistoryPanel
              entries={mergeDeviceTimeline(
                toHistoryEntries(history.data ?? [], t),
                timeline.data?.items ?? [],
                timelineFilter,
                t,
              )}
            />
            {/* API cắt mỗi nguồn ở trần chung của panel lịch sử — chạm trần thì nói ra. */}
            {(history.data?.length ?? 0) >= HISTORY_CAP ||
            (timeline.data?.items.length ?? 0) >= HISTORY_CAP ? (
              <p className="muted small">{t("devices.timelineCapped", { count: HISTORY_CAP })}</p>
            ) : null}
          </>
        )}
        </TabPanel>
      </DetailLayout>

      {retiring && !retired ? (
        <RetireDialog
          /* Đổi `key` khi API trả danh sách vướng: hộp dựng lại từ đầu, lựa chọn cũ không
             còn đứng sẵn — người dùng đọc danh sách mới rồi chọn lại. Khoá theo LƯỢT chứ
             không theo "có bị chặn không": lần 409 thứ hai mà `key` vẫn là "blocked" thì React
             giữ nguyên hộp, lựa chọn cũ đứng sẵn trên danh sách mới. */
          key={`retire-${retireRound}`}
          code={item.code}
          cut={retireCut}
          keep={retireKeep}
          unknown={panels.isError || panels.isPending || ports.isError || ports.isPending}
          blockedBy={retireBlocked}
          busy={setStatus.isPending}
          error={retireError}
          onCancel={closeRetire}
          onConfirm={(cleanup) =>
            setStatus.mutate(
              { status: "retired", cleanup },
              {
                onSuccess: () => {
                  closeRetire();
                  toast({ message: t("devices.statusChanged") });
                  void refresh();
                },
                onError: (err) => {
                  const holdings = holdingsOf(err);
                  if (holdings) {
                    setRetireError(null);
                    setRetireBlocked(holdings);
                    setRetireRound((round) => round + 1);
                    // Danh sách thứ đang giữ vừa đổi so với lúc mở trang — đọc lại.
                    void queryClient.invalidateQueries({ queryKey: ["devices", id] });
                    return;
                  }
                  setRetireError(errorMessage(err));
                },
              },
            )
          }
        />
      ) : null}

      {statusOpen ? (
        <StatusDialog
          code={item.code}
          current={item.status}
          reopen={retired}
          busy={setStatus.isPending}
          error={statusError}
          onCancel={() => setStatusOpen(false)}
          onConfirm={changeStatus}
        />
      ) : null}

      {assigningIp ? (
        <DeviceIpAssign
          device={{ id: item.id, code: item.code }}
          csrfToken={me.csrfToken}
          onClose={() => setAssigningIp(false)}
          onDone={() => {
            setAssigningIp(false);
            toast({ message: t("devices.ipAssigned") });
            void queryClient.invalidateQueries({ queryKey: ["devices", id] });
            void queryClient.invalidateQueries({ queryKey: ["ipam", "subnets"] });
          }}
        />
      ) : null}

      {cloning ? (
        <DeviceForm
          device={null}
          cloneFrom={item}
          csrfToken={me.csrfToken}
          onClose={() => setCloning(false)}
          onSaved={(_result, options) => {
            if (!options?.keepOpen) setCloning(false);
            void queryClient.invalidateQueries({ queryKey: ["devices"] });
          }}
          onOpenCreated={(created) => navigate(PATHS.device(created.id))}
        />
      ) : null}

      {editing ? (
        <DeviceForm
          device={item}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Khu mở rộng. Rỗng thì KHÔNG render gì cả — không có tiêu đề "Địa chỉ IP" treo lơ lửng,
 * cũng không có dòng "tính năng sẽ có sau". Người dùng không cần biết thứ chưa có.
 *
 * Dựng bằng BẢNG chứ không phải danh sách `nhãn: giá trị`.
 *
 * Danh sách định nghĩa chỉ đọc xuôi được từng cặp một; khi khu này có nhiều dòng cùng loại —
 * ba secret của một con switch, hai IP của một server — thì mắt phải nhảy qua nhảy lại để so.
 * Bảng xếp cùng loại vào một cột, và đó chính là việc người ta mở trang này ra để làm.
 */
function ExtensionPanels({
  panels,
  folded,
  onToggle,
}: {
  panels: DevicePanel[];
  folded: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (panels.length === 0) return null;
  return (
    <div className="device-panels">
      {/*
        `aria-labelledby` biến mỗi khu thành một LANDMARK CÓ TÊN ("Địa chỉ IP", "Sổ NAT",
        "Đường truyền ISP"). `<section>` không có tên thì trình đọc màn hình coi như một cái hộp
        vô danh — người dùng không nhảy giữa các khu được, phải nghe tuần tự từ đầu.

        Tác dụng thứ hai, thấy ngay hôm nay: bản đồ quan hệ ở trên cố ý nhắc lại vài giá trị của
        các khu này, nên "tìm chữ 172.16.31.1 trên trang" giờ ra ba chỗ. Có tên khu thì bài kiểm
        hỏi được đúng câu nó muốn hỏi — "trong khu Địa chỉ IP có dòng này không" — thay vì bám
        vào `id` hay tên class.
      */}
      {panels.map((panel) => (
        <ZoneSection
          key={panel.key}
          zoneKey={panel.key}
          title={panel.title}
          open={!folded.has(panel.key)}
          onToggle={panel.items.length > 0 ? () => onToggle(panel.key) : undefined}
        >
          {panel.items.length === 0 ? (
            <p className="muted">{panel.emptyText ?? "—"}</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <tbody>
                  {panel.items.map((entry, index) => (
                    <tr key={`${panel.key}-${index}`}>
                      {/* `scope="row"` chứ không phải `<td>`: ô đầu là TÊN của dòng, và trình
                          đọc màn hình cần biết điều đó để đọc "Admin web — ••••" chứ không
                          đọc hai ô rời nhau. */}
                      {/* Link đặt trên ĐỊNH DANH (IP, mã đường truyền), không trên câu mô tả:
                          người ta bấm vào cái họ đang tìm. */}
                      <th scope="row" className="panel-key">
                        {entry.link ? <Link to={entry.link}>{entry.label}</Link> : entry.label}
                      </th>
                      <td>
                        {entry.tone ? (
                          <span className={`badge ${entry.tone}`}>
                            {entry.value}
                          </span>
                        ) : (
                          entry.value
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ZoneSection>
      ))}
    </div>
  );
}

/**
 * Một khu chi tiết của tab Tổng quan, thu gọn được.
 *
 * Bản đồ quan hệ (hay hàng chip trên điện thoại) đã nói máy giữ bao nhiêu thứ mỗi loại; khu
 * này là bảng đầy đủ. Người chỉ cần con số thì gập nó lại cho trang ngắn. Mặc định MỞ: gập sẵn
 * thì người mở trang để xem IP phải bấm thêm một lần cho đúng thứ họ tìm.
 *
 * `aria-labelledby` trỏ vào `<h2>` nên khu vẫn là landmark mang đúng tên ("Địa chỉ IP"); nút
 * gập đứng NGOÀI `<h2>` để tên tiêu đề không dính chữ "Thu gọn". Nội dung gập thì gỡ khỏi cây
 * (không dùng `hidden`: vài lớp con đặt `display` đè luật `[hidden]` của trình duyệt).
 */
function ZoneSection({
  zoneKey,
  title,
  open,
  onToggle,
  children,
}: {
  zoneKey: string;
  title: string;
  open: boolean;
  /** Không truyền = khu không gập được (khu rỗng: chỉ một dòng chữ, gập lại chẳng được gì). */
  onToggle?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = `sec-${zoneKey}-title`;
  const bodyId = `sec-${zoneKey}-body`;
  const heading = (
    <h2 className="form-section-title" id={titleId}>
      {title}
    </h2>
  );
  return (
    <section id={`sec-${zoneKey}`} className="card device-panel" aria-labelledby={titleId}>
      {onToggle ? (
        <div className="form-section-head">
          {heading}
          <button
            type="button"
            className="btn sm ghost"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={t(open ? "devices.zoneCollapse" : "devices.zoneExpand", { title })}
            onClick={onToggle}
          >
            <Chevron direction={open ? "up" : "down"} />
          </button>
        </div>
      ) : (
        heading
      )}
      {open || !onToggle ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}



/** Danh sách thứ máy còn giữ trong 409 `DEVICE_HAS_HOLDINGS`; lỗi khác thì `null`. */
function holdingsOf(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { code?: string; holdings?: unknown } | null;
  if (body?.code !== "DEVICE_HAS_HOLDINGS" || !Array.isArray(body.holdings)) return null;
  return body.holdings.filter((entry): entry is string => typeof entry === "string");
}
