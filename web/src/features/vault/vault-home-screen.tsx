import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { OWNER_PATH } from '@/lib/routes';
import {
  SECRET_OWNER_KIND_KEY,
  SECRET_OWNER_TYPES,
  type SecretOwnerType,
} from '@/lib/secret-owner-kinds';
import { DataTable } from '@/ui/data-table';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { useListUrlState } from '@/ui/use-list-url-state';
import { VaultPanel } from '@/ui/vault-panel';
import { foldSearch } from '@/lib/search-fold';

interface VaultOwner {
  ownerType: SecretOwnerType;
  ownerId: string;
  code: string;
  name: string;
  siteCode: string | null;
  secretCount: number;
  lastChangeAt: string;
  orphan: boolean;
}

/**
 * Trang tổng Két sắt (`/vault`).
 *
 * Nó liệt kê **CHỦ THỂ đang giữ secret**, KHÔNG liệt kê secret: không tên ngăn, không giá
 * trị. FR-026 cấm mọi đường lấy secret qua nhiều chủ thể, và ranh giới đó được canh cả ở
 * `vault-surface.spec.ts` lẫn ở bài E2E của màn này.
 *
 * Bấm một dòng thì mở POPUP ngay tại chỗ thay vì chuyển trang — xem xong đóng lại là vẫn
 * đứng nguyên danh sách, không phải bấm quay lại rồi cuộn tìm lại dòng cũ. Popup nhúng đúng
 * `VaultPanel` đang dùng ở tab của trang chi tiết (AD-15), nên luật mở két — gõ TOTP, tự ẩn,
 * ghi nhật ký — y hệt, không có bản thứ hai để mà trôi lệch.
 */
function OpenButton({ row, onOpen }: { row: VaultOwner; onOpen: (row: VaultOwner) => void }) {
  const { t } = useTranslation();
  return (
    <div className="action-cell">
      <button
        type="button"
        className="btn sm"
        aria-label={t('vaultHome.openOf', { code: row.code })}
        onClick={(event) => {
          // Dòng cũng bấm được (onRowClick) — không để cú bấm nút mở hai lần.
          event.stopPropagation();
          onOpen(row);
        }}
      >
        {t('vaultHome.open')}
      </button>
    </div>
  );
}

export function VaultHomeScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  /*
   * Ô tìm và bộ lọc nằm trên THANH ĐỊA CHỈ, như bốn màn danh sách kia.
   *
   * `docs/SHARED-REGISTRY.md` viết thẳng: "Cấm quay lại `useState` cho bốn thứ đó". Đường đi
   * CHÍNH của màn này làm lộ đúng lý do: lọc + gõ tìm → mở két → bấm "Mở hồ sơ đầy đủ" → xem
   * xong bấm Back, và quay lại một danh sách trắng, phải gõ lại từ đầu. Chưa kể không gửi được
   * cho đồng nghiệp cái link "đây, mấy cái đường truyền đang giữ mật khẩu".
   *
   * Lọc loại là ĐA CHỌN nên nằm trên URL dưới dạng danh sách ngăn bằng dấu phẩy (`?kinds=device,isp`).
   */
  const url = useListUrlState<{ kinds: string }>({
    emptyFilters: { kinds: '' },
  });
  const search = url.search;
  const kinds = useMemo<SecretOwnerType[]>(
    () =>
      url.filters.kinds
        .split(',')
        .filter((item): item is SecretOwnerType =>
          (SECRET_OWNER_TYPES as readonly string[]).includes(item),
        ),
    [url.filters.kinds],
  );
  const [opened, setOpened] = useState<VaultOwner | null>(null);

  const owners = useQuery({
    queryKey: ['vault', 'owners'],
    queryFn: () => apiFetch<VaultOwner[]>('/api/v1/vault/owners'),
  });

  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canEdit = me.role === 'sa' || me.role === 'admin';

  const rows = useMemo(() => {
    // Gấp dấu cả hai vế: tên chủ sở hữu là tên thiết bị / phần mềm / tài khoản, toàn
    // tiếng Việt có dấu.
    const term = foldSearch(search.trim());
    return (owners.data ?? []).filter((row) => {
      if (kinds.length > 0 && !kinds.includes(row.ownerType)) return false;
      if (!term) return true;
      return (
        foldSearch(row.code).includes(term) ||
        foldSearch(row.name).includes(term) ||
        foldSearch(row.siteCode ?? '').includes(term)
      );
    });
  }, [owners.data, kinds, search]);

  /**
   * Đóng popup + nạp lại danh sách.
   *
   * `VaultPanel` làm mới bằng khóa `['vault', ownerType, ownerId]`, KHÔNG khớp tiền tố với
   * `['vault','owners']` của bảng này. Không tự nạp lại thì cất/thu hồi một ngăn xong đóng
   * popup là "Số ngăn" và "Thay đổi gần nhất" đứng im tới lúc tải lại trang — thu hồi ngăn
   * cuối còn để lại một dòng ma.
   *
   * MỘT hàm cho MỌI đường đóng (nút Đóng, Esc, bấm nền) — ba lối ra mà chỉ hai lối nạp lại
   * thì lỗi chỉ hiện ở lối còn lại, và đó thường là lối hay đi nhất.
   */
  const closePopup = () => {
    setOpened(null);
    void queryClient.invalidateQueries({ queryKey: ['vault', 'owners'] });
  };

  const all = owners.data ?? [];
  const toggle = (kind: SecretOwnerType) =>
    url.setFilter(
      'kinds',
      (kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind]).join(','),
    );

  /*
   * ĐẾM TRÊN TOÀN BỘ, không theo tập đang lọc — cùng luật với Kho thanh lý và Dải mạng.
   * Con số trên nút trả lời "có bao nhiêu thứ thuộc loại này", nên nó không được nhảy theo
   * chính cái nút vừa bấm; nếu không, tắt một bộ lọc rồi là không còn cách nào biết để bật lại.
   */
  const countOf = (kind: SecretOwnerType) =>
    all.filter((row) => row.ownerType === kind).length;

  /* Con số của tập ĐANG XEM thì nằm ở dòng tổng kết ngay trên bảng — xem chú thích ở đó. */
  const shownSecrets = rows.reduce((sum, row) => sum + row.secretCount, 0);

  /*
   * Bảng dùng chung (sắp được theo số ngăn / lần đổi gần nhất — "két nào lâu chưa đổi" là câu
   * của người đi xoay mật khẩu). ≤600px thành thẻ gọn: mã + tên, chip số ngăn, chạm cả thẻ
   * là mở két — không phải năm hàng nhãn–giá trị với nút nhỏ ở hàng cuối.
   */
  const columns = useMemo<ColumnDef<VaultOwner, unknown>[]>(
    () => [
      {
        id: 'owner',
        accessorFn: (row) => row.code,
        header: t('vaultHome.owner'),
        cell: ({ row }) => (
          <>
            <span className="mono">{row.original.code}</span>
            <span className="cell-sub">
              {row.original.orphan ? t('vaultHome.orphan') : row.original.name}
            </span>
          </>
        ),
      },
      {
        id: 'kind',
        accessorFn: (row) => row.ownerType,
        header: t('vaultHome.ownerKind'),
        cell: ({ row }) => (
          <span className="badge plain">{t(SECRET_OWNER_KIND_KEY[row.original.ownerType])}</span>
        ),
      },
      {
        id: 'site',
        accessorFn: (row) => row.siteCode ?? '',
        header: t('vaultHome.site'),
        cell: ({ row }) => orDash(row.original.siteCode),
      },
      {
        id: 'count',
        accessorFn: (row) => row.secretCount,
        header: t('vaultHome.secretCount'),
        meta: { className: 'num' },
        cell: ({ row }) => row.original.secretCount,
      },
      {
        id: 'lastChange',
        accessorFn: (row) => row.lastChangeAt,
        header: t('vaultHome.lastChange'),
        cell: ({ row }) => formatDateTime(row.original.lastChangeAt),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => <OpenButton row={row.original} onOpen={setOpened} />,
      },
    ],
    [t],
  );

  return (
    <>
      {/* Một dòng phụ đề là đủ; lời giải thích "vì sao không có trang đọc được mọi bí mật"
          về ở khối Luật cuối trang — ba nơi nói cùng một điều là đẩy danh sách xuống cả màn. */}
      <PageHeader title={t('vaultHome.title')} subtitle={t('vaultHome.subtitle')} />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('vaultHome.searchPlaceholder')}
      >
        {/* Các nút bật/tắt độc lập, không phải một ô chọn: "xem cả thiết bị lẫn phần mềm"
            là trạng thái thường gặp nhất, mà ô chọn một-giá-trị không diễn tả được.

            Duyệt thẳng `SECRET_OWNER_TYPES` chứ KHÔNG gõ lại danh sách ở đây: bản gõ tay cũ
            thiếu `isp`, nên bật bất kỳ nút nào cũng làm mọi dòng đường truyền biến mất im
            lặng — người dùng đọc ra "đường truyền không có két", còn két thì vẫn ở đó. */}
        {/* `role="group"` + tên nhóm: bốn nút rời rạc thì trình đọc màn hình đọc ra bốn cái nút
            không biết thuộc về đâu. */}
        {/* Nút bật/tắt độc lập (`.segmented` + `aria-pressed`) như ba chip trạng thái của Sổ NAT —
            không phải nút `primary`: chip đang bật mà mang màu nút chính thì lẫn với CTA. */}
        <div role="group" aria-label={t('vaultHome.filterKind')} className="segmented">
          {SECRET_OWNER_TYPES.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={kinds.includes(kind)}
              onClick={() => toggle(kind)}
            >
              {/* Số đếm đi kèm nhãn: "có đường truyền nào giữ két không" là câu hỏi màn này
                  sinh ra để trả lời, bắt bấm vào rồi mới đếm là bắt làm hai lần một việc — và
                  bấm ra bảng trống thì không phân biệt được "không có" với "mình lọc sai". */}
              {t(SECRET_OWNER_KIND_KEY[kind])}{' '}
              <span className="seg-count">{countOf(kind)}</span>
            </button>
          ))}
        </div>
        {kinds.length > 0 ? (
          /* Đường GỠ lọc — nút nhẹ, KHÔNG nằm trong dải chip để khỏi trông như một chip lọc nữa. */
          <button type="button" className="btn sm ghost" onClick={() => url.setFilter('kinds', '')}>
            {t('vaultHome.clearKinds')}
          </button>
        ) : null}
      </FilterBar>

      {owners.isLoading ? (
        <Loading />
      ) : owners.isError ? (
        <LoadError error={owners.error} onRetry={() => void owners.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title={t('vaultHome.empty')} hint={t('vaultHome.emptyHint')} />
      ) : (
        <>
          {/*
            DÒNG NÀY PHẢI NÓI SỐ CỦA TẬP ĐANG XEM, không đếm trên `all`: lọc "Thiết bị" còn
            3 dòng mà ngay phía trên vẫn đọc "12 hồ sơ đang giữ két · tổng 47 ngăn" là hai con
            số mâu thuẫn trên cùng một màn hình, và con số người dùng đang cần thì không có.
          */}
          {rows.length === 0 ? (
            /* Gợi ý theo ĐÚNG tình huống: có từ khoá thì cho nút xoá tìm, có lọc thì nút bỏ lọc —
               "bỏ bớt bộ lọc loại" khi không bật lọc nào là chỉ sai đường. */
            <EmptyState
              title={t('vaultHome.noHit')}
              hint={t(kinds.length > 0 ? 'vaultHome.noHitHintKinds' : 'vaultHome.noHitHint')}
              action={
                <>
                  {search.trim() ? (
                    <button type="button" className="btn sm" onClick={() => url.setSearchInput('')}>
                      {t('vaultHome.clearSearch')}
                    </button>
                  ) : null}
                  {kinds.length > 0 ? (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => url.setFilter('kinds', '')}
                    >
                      {t('vaultHome.clearKinds')}
                    </button>
                  ) : null}
                </>
              }
            />
          ) : (
            <>
              <p className="muted">
                {t('vaultHome.summary', { owners: rows.length, secrets: shownSecrets })}
              </p>
              <DataTable
                data={rows}
                columns={columns}
                emptyText={t('vaultHome.noHit')}
                mobileCard={{
                  title: (row) => row.code,
                  subtitle: (row) =>
                    row.orphan
                      ? t('vaultHome.orphan')
                      : [row.name, row.siteCode].filter(Boolean).join(' · '),
                  badge: (row) => (
                    <span className="badge muted">
                      {t('vaultHome.secretChip', { count: row.secretCount })}
                    </span>
                  ),
                  meta: (row) =>
                    `${t(SECRET_OWNER_KIND_KEY[row.ownerType])} · ${formatDateTime(row.lastChangeAt)}`,
                }}
                onRowClick={(row: VaultOwner) => setOpened(row)}
              />
            </>
          )}
        </>
      )}

      {opened ? (
        <Dialog
          open
          onOpenChange={closePopup}
          maxWidth={860}
          /* Dòng MỒ CÔI (hồ sơ chủ đã bị xoá, ngăn còn treo) có `code = '—'` và `name = ''`,
             nên khuôn cũ cho ra tiêu đề "Két sắt — —": cái hộp không tự giới thiệu được nó
             đang là két của ai. Nói thẳng ra là hồ sơ chủ không còn. */
          title={
            opened.orphan
              ? `${t('vaultHome.title')} — ${t('vaultHome.orphan')}`
              : `${t('vaultHome.title')} — ${opened.code}${opened.name ? ` · ${opened.name}` : ''}`
          }
          footer={
            <>
              {/* Đường sang hồ sơ đầy đủ vẫn giữ: xem két xong thường là muốn xem cả máy. */}
              {opened.orphan ? null : (
                <Link
                  className="linkbtn"
                  /* `OWNER_PATH` (lib/routes) chứ không phải chuỗi `if` tại chỗ: chuỗi `if`
                     kết bằng một nhánh vét như `return PATHS.softwareItem(...)` thì một đường
                     truyền rơi vào đó và cái nút này mở trang PHẦN MỀM với id đường truyền. */
                  to={OWNER_PATH[opened.ownerType](opened.ownerId)}
                >
                  {t('vaultHome.openRecord')}
                </Link>
              )}
              {/* PHẢI dùng `closePopup`, không phải `setOpened(null)` trần: nút này là đường
                  phần lớn người dùng đóng hộp, và danh sách chỉ nạp lại trong `closePopup` —
                  đóng trần thì đúng lối đi thường nhất lại không làm mới gì. */}
              {/* KHÔNG `primary`: nút nhấn mạnh của một hộp là việc người ta tới đây để làm,
                  mà ở đây việc đó là "Mở hồ sơ đầy đủ" — "Đóng" chỉ là lối ra. Tô đậm lối ra
                  là dạy người dùng bấm nút sáng nhất mà không đọc. */}
              <button type="button" className="btn" onClick={closePopup}>
                {t('common.close')}
              </button>
            </>
          }
        >
          {/*
            DÒNG MỒ CÔI THÌ CHỈ ĐỌC — và nói ra vì sao.

            Hồ sơ chủ đã bị xoá, nên `assertExists` ở tầng API sẽ từ chối mọi lượt ghi. Trước
            bản này popup vẫn bày nút "Cất secret": người dùng gõ xong cả form, gõ cả mã step-up
            rồi mới nhận lỗi — trả xong giá mà không được gì. Việc đúng ở đây là dọn ngăn treo,
            nhưng nó nằm trong menu ⋯ của từng dòng, nên câu giải thích phải có mặt.
          */}
          {opened.orphan ? <p className="alert warn">{t('vaultHome.orphanNote')}</p> : null}
          <VaultPanel
            ownerType={opened.ownerType}
            ownerId={opened.ownerId}
            ownerLabel={opened.code}
            me={me}
            canEdit={canEdit && !opened.orphan}
            /* Khung két đã nằm trong hộp này: bước mã và bước giá trị chạy ngay trong hộp,
               không chồng thêm hai hộp nữa lên trên (VLT-062). */
            stepsInline
          />
        </Dialog>
      ) : null}

      <section className="form-section">
        <h2 className="form-section-title">{t('vaultHome.rulesTitle')}</h2>
        <p className="muted">{t('vaultHome.whereItLives')}</p>
        <ul className="vault-rules">
          <li>{t('vaultHome.rule1')}</li>
          <li>{t('vaultHome.rule2')}</li>
          <li>{t('vaultHome.rule3')}</li>
          <li>{t('vaultHome.rule4')}</li>
        </ul>
      </section>
    </>
  );
}
