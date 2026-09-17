import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { DatePicker } from "@/ui/date-picker";
import { Dialog } from "@/ui/dialog";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { Field } from "@/ui/page-header";
import { WarrantyTimeline } from "@/ui/warranty-timeline";
import { TabPanel, Tabs } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { useToast } from "@/ui/toast";
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
    enabled: tab === "history",
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["isp"] });

  if (line.isLoading) return <Loading />;
  if (line.isError) {
    return line.error instanceof ApiError && line.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError error={line.error} onRetry={() => void line.refetch()} />
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
            {/* "Sửa hồ sơ" là việc chính của màn nên mang trọng số primary; "Gia hạn" lùi
                về nút thường — trước 17/09 hai cái ngược nhau. */}
            <button
              type="button"
              className="btn primary"
              onClick={() => setEditing(true)}
            >
              {t("isp.edit")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setRenewing(true)}
            >
              {t("isp.renew")}
            </button>
          </>
        }
      />

      <DetailLayout
        rail={
          <RailCard title={t("detail.identityCard")}>
            {/* HOTLINE đứng DÒNG ĐẦU, và là một link bấm gọi được. Đây là trang mở ra lúc 2 giờ
                sáng khi đứt cáp — thứ cần đầu tiên là số điện thoại, không phải mã hợp đồng. */}
            <RailRow label={t("isp.hotline")} note={item.provider}>
              {item.hotline ? (
                <a className="mono" href={`tel:${item.hotline.replace(/\s/g, "")}`}>
                  {item.hotline}
                </a>
              ) : (
                "—"
              )}
            </RailRow>
            <RailRow label={t("isp.status")}>
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </RailRow>
            {/* Thanh hợp đồng nằm HẲN ở đây, không còn thẻ thứ hai ở cột chính (17/09/2026). */}
            <RailRow label={t("isp.contract")}>
              {item.endDate ? (
                <WarrantyTimeline
                  start={item.startDate}
                  end={item.endDate}
                  startLabel={t("isp.startDate")}
                  endLabel={t("isp.endDate")}
                />
              ) : (
                <ExpiryBadge end={null} />
              )}
            </RailRow>
            <RailRowIfSet label={t("isp.contractNo")} value={item.contractNo} />
            <RailRowIfSet label={t("isp.bandwidth")} value={item.bandwidth} />
            <RailRowIfSet label={t("isp.site")} value={item.siteCode} />
          </RailCard>
        }
      >

      <Tabs
        items={[
          { key: "profile", label: t("isp.tabProfile") },
          /*
            Két sắt cho đường truyền (0036).
            Mật khẩu PPPoE và tài khoản quản trị modem nhà mạng trước đây không có chỗ đứng —
            `file.owner_type` đã nhận `isp` từ lâu mà `secret.owner_type` thì chưa, nên hợp
            đồng PDF đính vào được còn mật khẩu thì chảy vào ô Ghi chú, chỗ không mã hóa.
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
          <>
            {/* Nhà mạng · băng thông · IP tĩnh ĐÃ ở dòng định danh; hotline · trạng thái ·
                hợp đồng · số hợp đồng · site ĐÃ ở thẻ định danh bên phải. Lưới chỉ còn phần
                chưa nói ở đâu, và ô nào trống thì KHÔNG vẽ. */}
            <dl className="data-grid">
              <DataItemIfSet label={t("isp.device")} value={item.deviceId}>
                <Link className="mono" to={PATHS.device(item.deviceId!)}>
                  {item.deviceCode}
                </Link>
              </DataItemIfSet>
              <DataItemIfSet label={t("isp.note")} value={item.note} />
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
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toIspHistory(history.data ?? [], t)} />
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!renew.isPending}
      guardUnsaved
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
            /* `isp.endDate` là NHÃN của ô ("Hết hạn"). Đặt nó làm câu lỗi thì khối đỏ hiện
               đúng một chữ "Hết hạn" — không nói được là thiếu, sai, hay quá khứ. */
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


