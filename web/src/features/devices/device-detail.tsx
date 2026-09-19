import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
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
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { TabPanel, Tabs, initialTab, useVisibleTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { WarrantyTimeline } from "@/ui/warranty-timeline";
import { VaultPanel } from "@/ui/vault-panel";
import { useConfirm } from "@/ui/confirm-provider";
import { useToast } from "@/ui/toast";
import { DeviceLicensesExpand } from "@/features/software/device-licenses-expand";
import { DeviceForm } from "./device-form";
import { toHistoryEntries } from "./device-history-entries";
import { PortMapPanel, type PortMap } from "./port-map-panel";
import { RelationMap, type RelationNode } from "./relation-map";
import {
  STATUS_KEY,
  STATUS_TONE,
  locationLabel,
  type DeviceHistoryRow,
  type DeviceRow,
} from "@/lib/device-types";
import { PATHS } from "@/lib/routes";

/** Khu mở rộng do module khác đóng góp (Epic 3/4/5) — Đợt 1 luôn rỗng. */
interface DevicePanel {
  key: string;
  title: string;
  items: { label: string; value: string; link?: string; tone?: string }[];
  emptyText?: string;
}

/**
 * Trang chi tiết thiết bị tổng hợp (story 2.5, FR-001/002/006/007).
 *
 * Mở một trang thấy đủ: hồ sơ, tình trạng bảo hành, port map, giấy tờ, lịch sử.
 * Các khu IP · license · secret · phiếu đến từ `/devices/:id/panels` — module nào đăng ký
 * thì hiện, chưa có thì mảng rỗng và trang ẩn gọn, KHÔNG lỗi, không phụ thuộc tương lai.
 */
export function DeviceDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
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

  const history = useQuery({
    queryKey: ["devices", id, "history"],
    queryFn: () =>
      apiFetch<DeviceHistoryRow[]>(`/api/v1/devices/${id}/history`),
    enabled: tab === "history",
  });

  /*
   * Đếm cổng cho huy hiệu trên tab Port map.
   *
   * Trước 16/09 chỉ Giấy tờ và Két sắt có số, nên tab DÀY nhất lại là tab duy nhất trông như
   * rỗng — người đọc suy "không có số nghĩa là không có gì".
   *
   * Dùng ĐÚNG `queryKey` của `PortMapPanel` nên đây không phải lượt gọi thứ hai: bấm sang tab
   * là dữ liệu đã nằm sẵn trong cache, tab mở ra không còn quay vòng chờ.
   */
  /*
   * HỎI CỔNG CHO MỌI MÁY, không chỉ máy có port map (sửa 17/09/2026).
   *
   * Trước đây lượt gọi này bị tắt khi loại thiết bị không bật `has_port_map`. Nghe hợp lý —
   * máy in thì không có bảng cổng. Nhưng `/ports` trả về HAI chiều: cổng của chính máy này,
   * VÀ cổng của máy khác đang đấu vào nó. Chiều thứ hai chính là chiều mà một cái máy trạm có:
   * nó không có cổng nào để khai, nhưng ba con switch đang cắm vào nó — và cho tới hôm nay
   * hồ sơ của nó KHÔNG hiện chuyện đó ở bất cứ đâu.
   *
   * Hai chỗ hỏng vì thế: bản đồ quan hệ thiếu hẳn một nhánh, và quan trọng hơn, lượt xem
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
   * Tab Két sắt hiện cho MỌI vai kể từ story 6.3.
   *
   * Trước đây chỉ SA/Admin thấy. Nhưng Member giờ có thể được whitelist hoặc xin duyệt, và
   * quyền đó nằm ở ma trận 6.2 — client không tự suy ra được từ vai. Ẩn tab theo vai thì
   * người đã được gán quyền lại không có đường nào tới. Panel tự nói rõ tầng của người xem.
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
     * mình, nhưng "ai đang cắm vào tôi" là câu có thật và trước nay không trả lời được ở đâu.
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
     * `ports.isPending` cũng phải giữ tab lại (19/09/2026).
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
    // 404 = thiết bị không tồn tại → trang 404 tử tế, không phải khối lỗi đỏ "thử lại".
    return device.error instanceof ApiError && device.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError error={device.error} onRetry={() => void device.refetch()} />
    );
  }

  const item = device.data!;
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
  const goTab = (key: string) => {
    setTab(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goSection = (key: string) => {
    const el = document.getElementById(`sec-${key}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
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
      lines: panel.items.slice(0, 2).map((entry) => ({
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
    relationFromPanel("ipam", "ip", true, () => goSection("ipam")),
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
   * BA TRẠNG THÁI, KHÔNG PHẢI HAI (18/09/2026). Mỗi khu có thể ở một trong ba tình huống:
   *   · CÓ dòng            → vẽ nút trên bản đồ;
   *   · KHÔNG có dòng      → kể tên vào dòng "Chưa gắn";
   *   · CHƯA BIẾT          → không được nói gì cả.
   *
   * Hai lỗi cùng họ mà bản trước mắc:
   *
   * 1. `counts.files` được đọc bằng phép thử truthy, trong khi `ui/tab-counts.ts` khai rõ
   *    `undefined` = "chưa biết (đang tải, hoặc không có quyền xem), KHÔNG phải 0". Một hồ sơ
   *    có 4 giấy tờ mà `/attachments` chưa về sẽ bị khẳng định là "Chưa gắn: Giấy tờ".
   *
   * 2. Nút vẽ theo `panel.items.length > 0` nhưng dòng "Chưa gắn" lại theo `panelOf(key)` —
   *    hai vị từ khác nhau cho cùng một câu hỏi. Module `ipam` đăng ký panel nhưng máy chưa
   *    có IP nào → panel TỒN TẠI, `items` rỗng → không có nút, cũng KHÔNG có tên trong dòng
   *    "Chưa gắn". Khu đó tàng hình: người đọc không phân biệt được với "module chưa deploy".
   */
  const khuRong = (key: string): boolean => {
    const panel = panelOf(key);
    // Chưa đọc được sổ khu mở rộng → chưa biết, `chuaBiet` của bản đồ đã lo phần nói năng.
    if (!panels.data) return false;
    // Panel không tồn tại (module chưa deploy) HOẶC tồn tại mà rỗng — với người đọc là một.
    return !panel || panel.items.length === 0;
  };

  const relationMissing = [
    device.data?.hasPortMap && ownPorts.length === 0 ? t("devices.tabPortMap") : null,
    khuRong("ipam") ? t("nav.ipam") : null,
    khuRong("nat") ? t("nav.nat") : null,
    khuRong("isp") ? t("nav.isp") : null,
    khuRong("software") ? t("nav.software") : null,
    khuRong("vault") ? t("vault.tab") : null,
    counts.files === undefined ? null : counts.files === 0 ? t("devices.tabAttachments") : null,
  ].filter((label): label is string => label !== null);

  /* Câu tóm tắt lượt thanh lý — dựng từ CHÍNH những khu đang có, nên nó không bao giờ hứa cắt
     một thứ mà máy không giữ. Đây là câu mà `DEVICE_HAS_HOLDINGS` đang phải trả lời bằng một
     thông báo lỗi dài, chỉ khác là ở đây nhìn thấy TRƯỚC KHI bấm. */
  const cutList = relationNodes
    .filter((node) => node.cut)
    .map((node) => `${node.title} (${node.count})`);

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
        /*
         * Dòng định danh CHỈ còn serial (16/09/2026).
         *
         * Loại thiết bị đã nằm ở breadcrumb ngay phía trên, model là một ô của lưới Hồ sơ ngay
         * phía dưới — in lại ở đây là nói ba lần cùng một chuyện trong vòng 200px, và chủ dự án
         * chỉ ra đúng chỗ đó. Serial thì ở lại: nó là thứ người ta chép đi dán vào terminal,
         * nên nút chép phải nằm chỗ dễ với nhất.
         */
        subline={
          item.serial ? (
            <span>
              S/N <span className="mono">{item.serial}</span>
              <CopyButton value={item.serial} label={t("devices.copySerial")} />
            </span>
          ) : null
        }
        actions={
          <>
            {/* NÚT CHÍNH của màn phải NẶNG HƠN nút phá (16/09/2026).
                Trước đây "Sửa hồ sơ" là nút viền xám còn "Thanh lý" là nút nền đỏ đặc: việc
                làm mỗi ngày thì thì thầm, còn việc một năm một lần và không lấy lại được thì
                hét lên — ngay tại góc phải, đúng chỗ mắt và chuột tìm nút chính. */}
            <button
              type="button"
              className="btn primary"
              disabled={retired}
              title={retired ? t("devices.retiredLocked") : undefined}
              onClick={() => setEditing(true)}
            >
              {t("devices.edit")}
            </button>
            {/* ĐỎ khi là "Thanh lý", KHÔNG đỏ khi là "Mở lại".
                Màu đỏ nói "việc này lấy đi cái gì đó" — thanh lý khóa hồ sơ, dừng tính hạn,
                cắt máy khỏi email nhắc gia hạn. Mở lại là việc ngược lại, tô đỏ nó thì màu đỏ
                thành trang trí và lần sau người dùng không còn đọc nó như một cảnh báo nữa. */}
            <button
              type="button"
              /* `danger-ghost` chứ không phải `danger` nền đặc: đỏ vẫn nói "việc này lấy đi
                 cái gì đó", nhưng không còn là thứ nặng nhất trên màn. Nền đỏ đặc để dành cho
                 nút xác nhận TRONG hộp thoại — chỗ người ta đã đọc câu hỏi rồi. */
              className={retired ? "btn" : "btn danger-ghost"}
              onClick={() => {
                void (async () => {
                  let cleanup = false;
                  if (!retired) {
                    /*
                     * Ô tick "dọn hết thứ liên quan": không tick thì API CHẶN và liệt kê đích
                     * danh thứ máy còn giữ (IP, rule NAT, ghế license). Mặc định KHÔNG tick là
                     * có chủ ý — dọn tự động thu hồi IP và gỡ rule NAT trong một cú bấm, nên
                     * nó phải là điều người dùng nói ra.
                     */
                    const answer = await askConfirm({
                      title: t("common.titleOf", {
                        action: t("devices.retire"),
                        subject: item.code,
                      }),
                      message: t("devices.confirmRetire", { name: item.code }),
                      danger: true,
                      confirmLabel: t("devices.retire"),
                      checkbox: {
                        label: t("devices.retireCleanup"),
                        hint: t("devices.retireCleanupHint"),
                      },
                    });
                    if (!answer.ok) return;
                    cleanup = answer.checked;
                  } else {
                    /*
                     * ===== NHÁNH "ĐƯA LẠI VÀO DÙNG" CŨNG PHẢI HỎI (12/09, rà UI/UX #21) =====
                     *
                     * Mục #21 nói đúng một nửa: nút này CÙNG TỌA ĐỘ với "Thanh lý" hôm trước,
                     * nên trí nhớ cơ bắp dẫn tay tới đây. Bản trước nhánh `retired` đi thẳng
                     * vào `mutate` — tức một cú bấm theo quán tính đổi luôn trạng thái hồ sơ.
                     *
                     * VÌ SAO KHÔNG DỒN VÀO `RowActions` NHƯ HAI CHỖ BẢNG: đầu trang này chỉ có
                     * HAI nút, và một trong hai ("Sửa hồ sơ") là hành động chính của màn. Đẩy
                     * nút còn lại vào menu là dựng một menu MỘT MỤC — đúng thứ
                     * `docs/SHARED-REGISTRY.md` viết rõ là KHÔNG dùng ("thêm một cú bấm mà
                     * không giấu được gì"). Nên chỗ này vá cái hở thật: không tọa độ nào trên
                     * đầu trang đổi được trạng thái hồ sơ mà không hỏi một câu.
                     */
                    const ok = await askConfirm({
                      title: t("common.titleOf", {
                        action: t("devices.reopen"),
                        subject: item.code,
                      }),
                      message: t("devices.confirmReopen", { name: item.code }),
                      confirmLabel: t("devices.reopen"),
                    });
                    if (!ok) return;
                  }
                  setStatus.mutate(
                    { status: retired ? "in_use" : "retired", cleanup },
                    {
                      onSuccess: () => {
                        toast({ message: t("devices.statusChanged") });
                        void refresh();
                      },
                      onError: (err) =>
                        toast({ message: errorMessage(err), tone: "error" }),
                    },
                  );
                })();
              }}
            >
              {t(retired ? "devices.reopen" : "devices.retire")}
            </button>
          </>
        }
      />

      {retired ? <p className="alert">{t("devices.retiredLocked")}</p> : null}

      <DetailLayout
        rail={
          <RailCard title={t("detail.identityCard")}>
            <RailRow
              label={t("devices.status")}
              note={
                item.purchaseDate
                  ? t("devices.since", { date: formatDate(item.purchaseDate) })
                  : undefined
              }
            >
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </RailRow>
            {/* KHÔNG kèm `note={cabinetCode}`: `locationLabel` đã ghép sẵn "LST · T-1", nên
                dòng chú bên dưới in lại đúng mã tủ ấy lần thứ hai trong cùng một ô. */}
            <RailRow label={t("devices.location")}>
              <span className="mono">{locationLabel(item)}</span>
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
             * THANH HẠN NẰM Ở ĐÂY, KHÔNG CÒN Ở CỘT CHÍNH NỮA (16/09/2026).
             *
             * Trước đây tab Hồ sơ có hẳn một thẻ "Bảo hành" chiếm trọn bề ngang, in lại đúng ba
             * con số mà dải chỉ số đã có (còn N ngày, đến ngày nào, nhà cung cấp) — hai chỗ cách
             * nhau 40px. Và một thanh tiến độ kéo dài 1150px thì phần kéo dài ấy không nói thêm
             * gì cả. Hạn là TRẠNG THÁI của hồ sơ nên nó thuộc về thẻ định danh.
             *
             * Vẫn là `WarrantyTimeline` ĐẦY ĐỦ chứ không phải bản `compact`: bản gọn giấu hai
             * mốc ngày và dòng "Đã đi N%", mà đó là những thứ thanh này sinh ra để nói.
             */}
            <RailRow label={t("devices.warranty")}>
              {item.warrantyEnd ? (
                <WarrantyTimeline
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
            <RailRowIfSet label={t("devices.vendor")} value={item.vendorName} />
            <RailRowIfSet
              label={t("devices.purchaseDate")}
              value={formatDate(item.purchaseDate)}
            />
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
            <RelationMap
              hubCode={item.code}
              nodes={relationNodes}
              missing={relationMissing}
              /* Hai nguồn nuôi bản đồ: khu mở rộng (`/panels`) và cổng (`/ports`). Bất kỳ cái
                 nào chưa về hoặc hỏng thì bản đồ CHƯA BIẾT — không được nói "chưa giữ gì".
                 `counts` (giấy tờ, két) là nguồn thứ ba nhưng nó tự phân biệt được
                 `undefined` với 0, nên xử riêng ở `relationNodes`/`relationMissing`. */
              chuaBiet={
                panels.isError || panels.isPending || ports.isError || ports.isPending
              }
              /* Tách "đang tải" khỏi "hỏng": cả hai đều là CHƯA BIẾT, nhưng chỉ cái sau xứng
                 một lời cảnh báo. Xem chú thích prop `dangTai`. */
              dangTai={
                !panels.isError && !ports.isError && (panels.isPending || ports.isPending)
              }
              cutSummary={
                panels.isPending || ports.isPending
                  ? t("relationMap.cutLoading")
                  : panels.isError || ports.isError
                  ? t("relationMap.cutUnknown")
                  : cutList.length > 0 ? (
                  <>
                    <b>{t("relationMap.cutLead", { list: cutList.join(" · ") })}</b>
                    <br />
                    <br />
                    {t("relationMap.cutKeep")}
                  </>
                ) : (
                  t("relationMap.cutNothing")
                )
              }
            />

            {/*
             * Lưới này chỉ còn thứ CHƯA nói ở đâu khác. Thanh bảo hành, trạng thái, vị trí,
             * người dùng, nhà cung cấp, ngày mua đều đã ở thẻ định danh bên phải; serial thì ở
             * dòng định danh dưới tiêu đề, chỗ có nút chép. In lại ở đây là đúng lỗi bản trước.
             */}
            {/*
              KHU "HỒ SƠ" CÓ THẺ VÀ TIÊU ĐỀ NHƯ MỌI KHU KHÁC (19/09/2026).

              Trước đó lưới này render trần — không nền, không viền, không landmark có tên —
              trong khi MỌI khu bên dưới đều là `<section class="card" aria-labelledby>`. Khu
              ĐẦU TIÊN của cột chính lại là khu duy nhất lơ lửng, nên mắt đọc ra như phần thừa
              của thanh tab chứ không phải một khu riêng.

              `compact` vì ở ĐÂY các khu anh em đều là `device-panel`; ba màn chi tiết còn lại
              không truyền, xem chú thích của `DetailSection`. Vỏ khu nằm trong bản dùng chung
              chứ không chép ra đây (AD-15) — bản chép tay đã tồn tại đúng một ngày.

              Dòng "Chưa khai" nằm TRONG thẻ, không ngoài: nó nói về chính những ô của khu này,
              và `.blank-fields` đã có đường kẻ đứt riêng để tách khỏi lưới.
            */}
            <DetailSection title={t("detail.profileSection")} compact>
              <dl className="data-grid">
                <DataItemIfSet label={t("devices.model")} value={item.model} />
                <DataItemIfSet label={t("devices.note")} value={item.note} />
              </dl>

              {/* Ô chưa khai gom về MỘT dòng, thay cho một dãy hộp chỉ chứa dấu gạch ngang —
                  hồ sơ khai sơ sài trông như dữ liệu hỏng chứ không phải việc còn thiếu. */}
              <BlankFields
                labels={[
                  item.model ? null : t("devices.model"),
                  item.serial ? null : t("devices.serial"),
                  item.vendorName ? null : t("devices.vendor"),
                  item.department ? null : t("devices.department"),
                  item.purchaseDate ? null : t("devices.purchaseDate"),
                  item.note ? null : t("devices.note"),
                ].filter((label): label is string => label !== null)}
              />
            </DetailSection>

            {/* Phần mềm đang cài dùng BẢNG GHẾ đầy đủ (kỳ hạn · chi phí · hợp đồng), không
                phải khu `nhãn: giá trị` chung — cùng một bảng với khu bung dòng ở danh sách
                thiết bị, nên hai chỗ không thể trả lời khác nhau (AD-15).

                Tiêu đề lấy từ CHÍNH `panel.title` của API, không tự đặt một chuỗi thứ hai:
                module `software` là chủ sở hữu khu này (nó tự đăng ký vào sổ của `devices`),
                nên nó cũng là nơi quyết định khu ấy tên gì. Đặt tên riêng ở đây là để hai
                chỗ trôi lệch nhau, và bài kiểm e2e đã bắt đúng lúc chúng bắt đầu lệch. */}
            {softwarePanel ? (
              <section
                className="card device-panel"
                id="sec-software"
                aria-labelledby="sec-software-title"
              >
                <h2 className="form-section-title" id="sec-software-title">
                  {softwarePanel.title}
                </h2>
                <DeviceLicensesExpand deviceId={item.id} />
              </section>
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
            /* Ghi vào két là việc của SA/Admin. Member giờ MỞ được tab (story 6.3) nên
               phải chặn ở đây — không thì họ thấy "Cất secret"/"Xoay"/"Xóa" và bấm vào
               là 403 (code review Epic 6, finding 3). */
            canEdit={canVaultWrite && !retired}
          />
        ) : safeTab === "attachments" ? (
          <AttachmentPanel
            ownerType="device"
            ownerId={item.id}
            csrfToken={me.csrfToken}
            /* Thiết bị đã thanh lý: hồ sơ khóa lại thì giấy tờ cũng chỉ còn đọc/tải. */
            canEdit={!retired}
          />
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toHistoryEntries(history.data ?? [], t)} />
        )}
        </TabPanel>
      </DetailLayout>

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
 * cũng không có dòng "tính năng sẽ có ở epic sau". Người dùng Đợt 1 không cần biết Đợt 2.
 *
 * Dựng bằng BẢNG chứ không phải danh sách `nhãn: giá trị`.
 *
 * Danh sách định nghĩa chỉ đọc xuôi được từng cặp một; khi khu này có nhiều dòng cùng loại —
 * ba secret của một con switch, hai IP của một server — thì mắt phải nhảy qua nhảy lại để so.
 * Bảng xếp cùng loại vào một cột, và đó chính là việc người ta mở trang này ra để làm.
 */
function ExtensionPanels({ panels }: { panels: DevicePanel[] }) {
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
        <section
          key={panel.key}
          id={`sec-${panel.key}`}
          className="card device-panel"
          aria-labelledby={`sec-${panel.key}-title`}
        >
          <h2 className="form-section-title" id={`sec-${panel.key}-title`}>
            {panel.title}
          </h2>
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
                      <th scope="row" className="panel-key">
                        {entry.label}
                      </th>
                      <td>
                        {entry.link ? (
                          <Link to={entry.link}>{entry.value}</Link>
                        ) : entry.tone ? (
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
        </section>
      ))}
    </div>
  );
}


