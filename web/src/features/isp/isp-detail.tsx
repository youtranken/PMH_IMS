import { PhoneLink } from '@/ui/phone-link';
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { bandwidthLabel } from "@/lib/bandwidth";
import { apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { HistoryPanel } from "@/ui/history-panel";
import { AuditLogLink } from "@/ui/audit-log-link";
import { DetailLoadFailed, LoadError, Loading } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { DetailHeader } from "@/ui/detail-header";
import { FactStrip, SpecList } from "@/ui/detail-facts";
import {
  DetailLayout,
  DetailSection,
} from "@/ui/detail-layout";
import { TabPanel, Tabs, initialTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { IspForm } from "./isp-form";
import { liquidationOf, toIspHistory } from "./isp-history-entries";
import {
  ACTION_KEY,
  STATUS_KEY,
  STATUS_TONE,
  type IspHistoryRow,
  type IspRow,
  type IspStatus,
} from "./isp-types";
import { errorMessage, useMe } from "@/lib/api";
import { canSee } from "@/lib/features";
import { RowActions } from "@/ui/row-actions";
import { useOwnerSecrets } from "@/ui/vault-panel";
import { ispMenuItems, parseIspAction } from "./isp-status-menu";
import { useConfirm } from "@/ui/confirm-provider";
import { useToast } from "@/ui/toast";
import { PATHS } from "@/lib/routes";
import { RecordStamp } from "@/ui/record-stamp";

/**
 * Trang chi tiết đường truyền.
 * Tab Giấy tờ dùng lại `AttachmentPanel` chung — file scan hợp đồng gắn thẳng vào đường này.
 */
export function IspDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  // `?tab=vault` từ thư "đã được duyệt": người xin mở thẳng két, không phải tìm tab.
  const [tab, setTab] = useState(() =>
    initialTab(params.get("tab"), ["profile", "vault", "attachments", "history"]),
  );
  const [editing, setEditing] = useState(false);
  const askConfirm = useConfirm();
  const toast = useToast();

  /* Trước mọi nhánh `return` sớm bên dưới: đây là hook, đặt sau `if (isLoading) return` thì
     số hook giữa hai lượt render lệch nhau. */
  const counts = useTabCounts("isp", id, me);

  const line = useQuery({
    queryKey: ["isp", id],
    queryFn: () => apiFetch<IspRow>(`/api/v1/isp-lines/${id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ["isp", id, "history"],
    queryFn: () => apiFetch<IspHistoryRow[]>(`/api/v1/isp-lines/${id}/history`),
    // Hỏi sổ ngay khi mở trang: dòng "sửa lần cuối … bởi …" dưới dải 4 ô cần lượt mới nhất (UX-E26).
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["isp"] });

  /*
   * `?action=` từ menu ⋮ của danh sách: chờ tới khi biết số ngăn két (câu hỏi lại của Thanh lý
   * nhắc hủy mật khẩu trong két — hỏi trước khi đếm xong là nói thiếu), rồi hỏi đúng MỘT lần
   * và gỡ tham số, để F5 hay Back không bật lại hộp.
   */
  const vault = useOwnerSecrets("isp", id, me);
  const vaultKnown = vault.verdict.isFetched && (!vault.allowed || vault.secrets.isFetched);
  const changeStatusRef = useRef<((next: IspStatus) => Promise<void>) | null>(null);
  const pendingAction = line.data ? parseIspAction(params.get("action"), line.data.status) : null;
  useEffect(() => {
    if (!params.has("action") || !line.data || !vaultKnown) return;
    setParams(
      (next) => {
        next.delete("action");
        return next;
      },
      { replace: true },
    );
    if (pendingAction) void changeStatusRef.current?.(pendingAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.data, vaultKnown, pendingAction]);

  if (line.isLoading) return <Loading />;
  if (line.isError) {
    // Giữ đường lùi về danh sách, và tách "hồ sơ không còn" (404) khỏi "máy chủ lỗi".
    return (
      <DetailLoadFailed
        error={line.error}
        onRetry={() => void line.refetch()}
        backTo={PATHS.ispLines}
        backLabel={t("nav.isp")}
      />
    );
  }

  // Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined:
  // hai nhánh trên đều trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx`.
  if (!line.data) return <Loading />;
  const item = line.data;
  const terminated = item.status === "terminated";
  const liquidation = terminated ? liquidationOf(history.data ?? []) : null;

  /**
   * Đổi trạng thái từ menu ⋯ — luôn hỏi lại. Thanh lý nhắc hai việc KHÔNG tự xảy ra: huỷ mật
   * khẩu PPPoE/modem trong két, và gỡ đường khỏi Draytek đang cắm.
   */
  const changeStatus = async (next: IspStatus) => {
    const vaultNote =
      counts.secrets && counts.secrets > 0 ? t("isp.terminateVault", { count: counts.secrets }) : "";
    const deviceNote = item.deviceCode ? t("isp.terminateDevice", { device: item.deviceCode }) : "";
    const ok = await askConfirm({
      title: t(`isp.statusTitle_${next}`, { code: item.code }),
      message: [t(`isp.statusMessage_${next}`), vaultNote, deviceNote].filter(Boolean).join(" "),
      confirmLabel: t(ACTION_KEY[next]),
      danger: next === "terminated",
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/v1/isp-lines/${item.id}`, {
        method: "PATCH",
        csrfToken: me.csrfToken,
        body: JSON.stringify({ status: next }),
      });
      toast({ message: t("isp.saved") });
      void refresh();
    } catch (error) {
      toast({ message: errorMessage(error), tone: "error" });
    }
  };
  changeStatusRef.current = changeStatus;

  /* Mọi trường chưa nói ở dải 4 ô, đủ cả, theo thứ tự cố định — ô trống ghi "chưa khai". */
  const specItems = [
    { label: t("isp.bandwidth"), value: bandwidthLabel(item.bandwidth) },
    { label: t("isp.site"), value: item.siteCode },
    { label: t("isp.startDate"), value: item.startDate ? formatDate(item.startDate) : null },
    { label: t("isp.note"), value: item.note },
  ];
  const specBlank = specItems.filter((entry) => !entry.value).length;

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
        /* Trạng thái đứng dưới mã như mọi trang khuôn C (Q-27). Tốc độ gói cước, site, ngày bắt
           đầu có nhãn trong khu Thông số — đứng trơn ở đây thì "400" không biết là gì. */
        subline={
          <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
        }
        actions={
          /*
           * Không có nút Gia hạn: đường truyền không có hạn (Q-04). Đổi trạng thái (Tạm ngưng,
           * Thanh lý…, Dùng lại) đi menu ⋯ và luôn hỏi lại. "Sửa hồ sơ" luôn đứng ngoài, cả trên
           * điện thoại — mọi trang chi tiết một kiểu (Q-27). Đã thanh lý thì Sửa hạ xuống nút
           * thường: nó không còn là việc chính của trang.
           */
          <>
            <button
              type="button"
              className={terminated ? "btn" : "btn primary"}
              onClick={() => setEditing(true)}
            >
              {t("isp.edit")}
            </button>
            <RowActions
              label={t("common.actionsOf", { subject: item.code })}
              items={ispMenuItems(t, item.status, (next) => void changeStatus(next))}
            />
          </>
        }
      />

      {/* Đường đã thanh lý phải TRÔNG như đã thanh lý — không chỉ một huy hiệu xám nhỏ dưới
          mã. Chưa có mốc trong sổ lịch sử (dữ liệu cũ) thì nói thẳng là chưa rõ. */}
      {terminated ? (
        <p className="alert warn" role="note">
          {liquidation
            ? t("isp.liquidated", {
                date: formatDate(liquidation.at),
                actor: liquidation.actor,
              })
            : t("isp.liquidatedUnknown")}
        </p>
      ) : null}

      {/*
        Dải 4 ô (khuôn C, Q-27) là đúng những thứ cần khi mất mạng lúc 2 giờ sáng: gọi số nào,
        IP WAN nào, cắm vào máy nào (kèm model + IP LAN để vào trang quản trị), đọc số hợp đồng
        nào cho tổng đài. Thấy ở mọi tab; ô trống ghi "chưa khai".
      */}
      <FactStrip
        label={t("isp.factsLabel")}
        facts={[
          {
            key: "hotline",
            label: t("isp.hotline"),
            value: item.hotline ? <PhoneLink value={item.hotline} /> : null,
          },
          {
            key: "wan",
            label: t("isp.wanIp"),
            /* Mỗi IP một nút chép (Q-20) — lúc gọi nhà mạng người ta đọc từng IP một. */
            value:
              item.wanIps.length > 0 ? (
                <span className="wan-ips">
                  {item.wanIps.map((ip, index) => (
                    <span key={ip}>
                      {index > 0 ? ", " : null}
                      {/* Không chèn dấu cách giữa IP và nút: bản `inline` đã có đệm quanh hình,
                          thêm dấu cách là dấu phẩy sau nó trông như "a , b". */}
                      <span className="mono">{ip}</span>
                      <CopyButton value={ip} label={`${t("isp.copyWanIp")} ${ip}`} inline />
                    </span>
                  ))}
                </span>
              ) : null,
          },
          {
            key: "device",
            label: t("isp.device"),
            value: item.deviceId ? (
              <Link className="mono" to={PATHS.device(item.deviceId)}>
                {item.deviceCode}
              </Link>
            ) : null,
            note: item.deviceId ? (
              <EdgeFacts deviceId={item.deviceId} deviceName={item.deviceName} />
            ) : null,
            /* Rule NAT đang mở trên chính con router này — luồng "ghi line → gắn router → mở
               port" không bắt đi tìm qua ba màn. */
            action: item.deviceId ? (
              <Link className="rail-sublink" to={PATHS.natOf(item.deviceId)}>
                {t("isp.natOnDevice")}
              </Link>
            ) : null,
          },
          {
            key: "contract",
            label: t("isp.contractNo"),
            value: item.contractNo ? (
              <>
                <span className="mono">{item.contractNo}</span>
                <CopyButton value={item.contractNo} label={t("isp.copyContractNo")} inline />
              </>
            ) : null,
          },
        ]}
      />
      <RecordStamp createdAt={item.createdAt} last={history.data?.[0]} onOpenHistory={() => setTab("history")} />

      {/* Một cột: trạng thái ở đầu trang, việc cần lúc mất mạng (hotline, IP WAN, thiết bị,
          số hợp đồng) ở dải 4 ô — không còn gì cho cột phải. */}
      <DetailLayout>
      <Tabs
        items={[
          { key: "profile", label: t("isp.tabOverview") },
          /*
            Két sắt cho đường truyền: mật khẩu PPPoE và tài khoản quản trị modem nhà mạng
            phải có chỗ mã hoá riêng — không có tab này thì chúng chảy vào ô Ghi chú, chỗ
            không mã hoá.
          */
          { key: "vault", label: t("vault.tab"), count: counts.secrets },
          {
            key: "attachments",
            label: t("isp.tabAttachments"),
            count: counts.files,
          },
          { key: "history", label: t("isp.tabHistory") },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("isp.title")}
      />

      <TabPanel tabKey={tab}>
        {tab === "profile" ? (
          /* Thông số thứ tự cố định, cùng khuôn với thiết bị / phần mềm (Q-27): ô trống đứng
             đúng chỗ và ghi "chưa khai". Đã thanh lý thì thôi mời bổ sung. */
          <DetailSection
            title={t("isp.specTitle")}
            action={
              !terminated && specBlank > 0 ? (
                <button type="button" className="btn sm" onClick={() => setEditing(true)}>
                  {t("isp.fillBlanks", { count: specBlank })}
                </button>
              ) : null
            }
          >
            <SpecList label={t("isp.specTitle")} items={specItems} />
          </DetailSection>
        ) : tab === "vault" ? (
          <VaultPanel
            ownerType="isp"
            ownerId={item.id}
            ownerLabel={item.code}
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
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <>
            <AuditLogLink role={me.role} objectType="isp_line" objectId={item.id} />
            <HistoryPanel entries={toIspHistory(history.data ?? [], t)} />
          </>
        )}
      </TabPanel>
      </DetailLayout>

      {editing ? (
        <IspForm
          row={item}
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
 * Tên, model và IP LAN của thiết bị biên, ngay dưới mã máy ở dải 4 ô: đứt cáp thì việc kế tiếp
 * là vào trang quản trị router — phải biết địa chỉ mà không bấm sang trang khác. Đọc qua
 * `devices` và `ipam` (AD-2); hỏng thì ô chỉ thiếu mấy chữ này.
 */
function EdgeFacts({ deviceId, deviceName }: { deviceId: string; deviceName: string | null }) {
  const { t } = useTranslation();
  const device = useQuery({
    queryKey: ["devices", deviceId],
    queryFn: () => apiFetch<{ model: string | null }>(`/api/v1/devices/${deviceId}`),
  });
  // IP LAN thuộc mảng Mạng (Q-31): nhóm không có Mạng thì không hỏi.
  const { data: me } = useMe();
  const ips = useQuery({
    enabled: canSee(me, "network"),
    queryKey: ["ipam", "devices", "addresses", [deviceId]],
    queryFn: () =>
      apiFetch<Record<string, string[]>>(`/api/v1/ipam/devices/addresses?deviceIds=${deviceId}`),
  });
  const lan = ips.data?.[deviceId] ?? [];
  const model = device.data?.model ?? null;
  return (
    <span className="edge-facts">
      {deviceName ? <span>{deviceName}</span> : null}
      {model ? <span>{`${t("isp.edgeModel")} ${model}`}</span> : null}
      {lan.map((ip) => (
        <span key={ip}>
          {`${t("isp.edgeLanIp")} `}
          <span className="mono">{ip}</span>
          <CopyButton value={ip} label={t("devices.copyIp")} inline />
        </span>
      ))}
    </span>
  );
}
