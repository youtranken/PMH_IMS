import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Chevron } from './chevron';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { SkeletonCards, SkeletonRows } from '@/ui/skeleton-rows';
import { useScrollEdges } from '@/ui/scroll-x';
import { useMediaQuery } from '@/ui/use-media-query';

// Cho phép cột khai báo className (vd 'num' căn phải cột số) qua columnDef.meta.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
    /**
     * Cột DÍNH khi bảng cuộn ngang: `start` bám mép trái (cột định danh, vd "Cổng"), `end` bám
     * mép phải (cột thao tác). Bảng gập thẻ dọc (`.table-stack`) thì bỏ dính.
     */
    sticky?: 'start' | 'end';
  }
}

/**
 * Mốc chuyển bảng → thẻ gọn. PHẢI khớp `@media (max-width: 600px)` của `.list-card*` trong
 * `css/table.css`.
 */
export const MOBILE_CARD_QUERY = '(max-width: 600px)';

/**
 * Thẻ gọn thay cho bảng trên điện thoại. Mọi khe là hàm của dòng; bỏ khe nào thì thẻ không có
 * phần đó.
 *
 * `title` nên là CHỮ THUẦN (mã hồ sơ): bảng tự bọc nó thành link (`href`) hoặc nút
 * (`onRowClick`) phủ cả thẻ — tự bọc thêm link bên trong là thành tương tác lồng nhau.
 */
export interface MobileCard<T> {
  /** Dòng 1 bên trái — định danh (mã, hoặc họ tên / nhãn khi màn không có mã). */
  title: (row: T) => ReactNode;
  /**
   * Tiêu đề là MÃ (thiết bị, phần mềm, đường truyền…) → phông mono. Mặc định không: họ tên hay
   * nhãn dài mà ép mono thì vừa rộng vừa khó đọc.
   */
  titleIsCode?: boolean;
  /** Góc phải trên — badge trạng thái. */
  badge?: (row: T) => ReactNode;
  /** Góc phải trên, sau badge — menu ⋯ (`RowActions`). Bấm vào đây không mở dòng. */
  actions?: (row: T) => ReactNode;
  /** Dòng 2 — tên hồ sơ. */
  subtitle?: (row: T) => ReactNode;
  /** Dòng 3 — thông tin phụ nhỏ, xám ("site · tủ · người dùng"). */
  meta?: (row: T) => ReactNode;
  /** Góc phải dưới — chip hạn, nút nhỏ. Bấm vào đây không mở dòng. */
  aside?: (row: T) => ReactNode;
  /** Có giá trị → cả thẻ là link sang đường này (ưu tiên hơn `onRowClick`). */
  href?: (row: T) => string;
}

/** Trạng thái expand đưa xuống cột (qua table.meta) để ô đầu tự vẽ caret › như /software. */
interface ExpandMeta<T> {
  expandedId: string | null;
  canExpandRow: (row: T) => boolean;
  toggleExpand: (id: string) => void;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  emptyText: string;
  /** Đang tải lần đầu → hiện spinner thay empty-state (phân biệt tải ≠ rỗng, S1). */
  loading?: boolean;
  /** Có giá trị → hiện ô tìm kiếm toàn bảng (lọc client, debounce). */
  searchPlaceholder?: string;
  initialSort?: SortingState;
  /** Class cho từng <tr> theo dữ liệu dòng (vd dòng quá hạn tô đỏ). */
  rowClassName?: (row: T) => string;
  /** Class thêm cho <table> (giữ style riêng của trang, vd 'board-table'). */
  tableClassName?: string;
  /** Sort server-side: không sắp client, parent giữ `sorting` + refetch qua `onSortingChange`. */
  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Bấm cả dòng (vd mở chi tiết). Kèm bàn phím (Enter/Space) cho a11y. */
  onRowClick?: (row: T) => void;
  /**
   * Có giá trị → thêm cột ▸ để BUNG 1 hàng chi tiết in-context ngay dưới dòng
   * (trang Tài sản). Không truyền → bảng giữ nguyên như cũ (mọi trang khác).
   */
  renderExpanded?: (row: T) => ReactNode;
  /** Chỉ hiện mũi tên ▸ khi hàm này trả true (vd máy có phần mềm). Mặc định: mọi dòng. */
  canExpand?: (row: T) => boolean;
  /**
   * Tên của nút ▸ cho trình đọc màn hình ("Mở rộng LIC-01 — xem máy đang dùng"). Không truyền
   * thì mọi dòng cùng một câu "Mở rộng dòng", nghe mười lần không biết dòng nào.
   */
  expandLabel?: (row: T, expanded: boolean) => string;
  /**
   * Chữ đứng cạnh mũi tên bung ("3 license").
   *
   * @deprecated Mẫu chuẩn (Q-18) là mũi tên trơn: số đếm đi vào `expandLabel` (tên cho trình
   * đọc màn hình) và vào `ExpandHeader` trong khu bung. Không màn nào còn dùng.
   */
  expandText?: (row: T) => string;
  /** ≤680px gập bảng thành thẻ dọc (mỗi ô 1 dòng có nhãn cột). */
  stackOnMobile?: boolean;
  /** Có giá trị → cột đầu (cùng ô ▸) hiện số thứ tự "#" = offset + vị trí + 1. Cần renderExpanded. */
  rowNumberOffset?: number;
  /** Chọn nhiều dòng (5.1): checkbox đầu dòng + chọn-tất-cả theo trang hiện tại. */
  selection?: {
    selected: Set<string>;
    onToggle: (id: string) => void;
    onToggleAll: (ids: string[], checked: boolean) => void;
  };
  /**
   * Cột CUỐI (thao tác) dính mép phải khi bảng cuộn ngang, kèm bóng mép khi còn cột khuất.
   * Tương đương khai `meta: { sticky: 'end' }` trên cột cuối.
   */
  stickyActions?: boolean;
  /**
   * ≤600px vẽ danh sách thẻ gọn thay cho bảng (thay luôn `stackOnMobile` ở bề ngang đó).
   * Thẻ không có ô chọn nhiều dòng và không bung dòng; màn cần hai thứ đó trên điện thoại thì
   * đừng truyền prop này. Không truyền → giữ nguyên hành vi cũ.
   */
  mobileCard?: MobileCard<T>;
  /**
   * Kẻ một dòng tiêu đề mỗi khi khoá nhóm đổi — "Hôm nay", "Tháng 10/2026". Dữ liệu phải XẾP
   * SẴN theo khoá (bảng không tự sắp lại): nhóm chỉ là cách đọc thứ tự đang có, nên màn chỉ
   * truyền prop này khi thứ tự hiện tại đúng là thứ tự của khoá.
   */
  groupBy?: TableGroupBy<T>;
}

export interface TableGroupBy<T> {
  key: (row: T) => string;
  label: (key: string, row: T) => ReactNode;
}

/** Dòng nào mở đầu một nhóm mới (so với dòng liền trước) — dùng chung cho bảng và thẻ. */
export function groupStarts<T>(rows: readonly T[], key: (row: T) => string): boolean[] {
  return rows.map((row, index) => index === 0 || key(row) !== key(rows[index - 1]));
}

/** Gộp class của cột với class cột dính. */
function cellClass(
  meta: { className?: string; sticky?: 'start' | 'end' } | undefined,
  stickyEnd: boolean,
): string | undefined {
  const sticky = meta?.sticky ?? (stickyEnd ? 'end' : undefined);
  return (
    [meta?.className, sticky ? `col-sticky-${sticky}` : ''].filter(Boolean).join(' ') ||
    undefined
  );
}

/**
 * Khung cuộn ngang của bảng, đánh dấu mép còn cột khuất (`data-more-start/end`) để cột dính
 * vẽ bóng mép. Dùng được cho `<table className="table">` viết tay có cột `col-sticky-*`.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(ref);
  return (
    <div
      ref={ref}
      className="table-wrap"
      data-more-start={edges.start ? 'true' : undefined}
      data-more-end={edges.end ? 'true' : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Bảng dùng chung (design-system, review nguyên tắc #3): sort theo cột (asc→desc→bỏ),
 * search toàn bảng, trạng thái rỗng — headless TanStack Table, GIỮ nguyên CSS `.table`.
 * Thay các <table> tự viết không sort được ("0 bảng sort được" — review mục 5.1).
 */
export function DataTable<T>({
  data,
  columns,
  emptyText,
  loading,
  searchPlaceholder,
  initialSort = [],
  rowClassName,
  tableClassName,
  manualSorting,
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  onRowClick,
  renderExpanded,
  canExpand,
  expandLabel,
  expandText,
  stackOnMobile,
  selection,
  rowNumberOffset,
  stickyActions,
  mobileCard,
  groupBy,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const narrow = useMediaQuery(MOBILE_CARD_QUERY);
  const [internalSort, setInternalSort] = useState<SortingState>(initialSort);
  const [globalFilter, setGlobalFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandIdBase = useId();
  // IDREF tách nhau bằng khoảng trắng: mã dòng có dấu cách thì `aria-controls` trỏ vào hai id rỗng.
  const expandRegionId = (rowId: string) => `${expandIdBase}-exp-${rowId.replace(/\s/g, '_')}`;
  // Controlled (server-side) nếu parent truyền sorting; ngược lại tự giữ state (client).
  const sorting = controlledSorting ?? internalSort;
  const onSortingChange = controlledOnSortingChange ?? setInternalSort;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange,
    onGlobalFilterChange: setGlobalFilter,
    // asc-first nhất quán mọi cột (mặc định TanStack sort số theo desc-first — khó đoán cho user).
    sortDescFirst: false,
    globalFilterFn: 'includesString',
    manualSorting: manualSorting ?? false,
    // ID ổn định theo dữ liệu (không phải index): tránh hàng bung ▸ "dính" sai bản ghi
    // khi phân trang/sort/refetch thay đổi thứ tự (trang Tài sản dùng renderExpanded).
    getRowId: (row, index) => {
      const r = row as { id?: string | number };
      return r.id != null ? String(r.id) : String(index);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Cột đầu (Code) tự vẽ caret › mở/đóng như /software — đọc qua cell.table.options.meta.
    meta: {
      expandedId,
      canExpandRow: (r: T) => !!renderExpanded && (canExpand?.(r) ?? true),
      toggleExpand: (id: string) =>
        setExpandedId((cur) => (cur === id ? null : id)),
    } satisfies ExpandMeta<T>,
  });

  const rows = table.getRowModel().rows;
  // Dữ liệu đổi (sang trang/lọc) mà dòng đang bung không còn → thu gọn để không hiện nhầm.
  useEffect(() => {
    if (expandedId && !rows.some((r) => r.id === expandedId)) {
      setExpandedId(null);
    }
  }, [rows, expandedId]);

  const lastColumnId = table.getAllLeafColumns().at(-1)?.id;

  if (mobileCard && narrow) {
    return (
      <>
        {searchPlaceholder !== undefined && (
          <SearchBox onChange={setGlobalFilter} placeholder={searchPlaceholder} />
        )}
        {rows.length === 0 ? (
          <div className="list-cards-empty">
            {loading ? <SkeletonCards /> : <div className="empty">{emptyText}</div>}
          </div>
        ) : (
          <MobileCardList
            rows={rows.map((row) => row.original)}
            rowKey={(_, index) => rows[index].id}
            card={mobileCard}
            rowClassName={rowClassName}
            onRowClick={onRowClick}
            groupBy={groupBy}
          />
        )}
      </>
    );
  }

  const columnCount =
    table.getAllLeafColumns().length + (renderExpanded ? 1 : 0) + (selection ? 1 : 0);
  const starts = groupBy ? groupStarts(rows.map((row) => row.original), groupBy.key) : null;

  return (
    <>
      {searchPlaceholder !== undefined && (
        <SearchBox onChange={setGlobalFilter} placeholder={searchPlaceholder} />
      )}
      <TableWrap>
        <table
          className={[
            'table',
            tableClassName,
            stackOnMobile ? 'table-stack' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {selection && (
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      aria-label={t('dataTable.selectAll')}
                      checked={
                        rows.length > 0 &&
                        rows.every((r) => selection.selected.has(r.id))
                      }
                      onChange={(e) =>
                        selection.onToggleAll(
                          rows.map((r) => r.id),
                          e.target.checked,
                        )
                      }
                    />
                  </th>
                )}
                {renderExpanded && (
                  <th
                    className="lead-col"
                    aria-hidden={rowNumberOffset == null || undefined}
                    style={{ width: expandText ? undefined : rowNumberOffset != null ? 56 : 34 }}
                  >
                    {rowNumberOffset != null ? '#' : null}
                  </th>
                )}
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const hm = h.column.columnDef.meta;
                  return (
                    <th
                      key={h.id}
                      className={cellClass(hm, !!stickyActions && h.column.id === lastColumnId)}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : h.column.getCanSort()
                              ? 'none'
                              : undefined
                      }
                    >
                      {h.isPlaceholder ? null : h.column.getCanSort() ? (
                        <button
                          type="button"
                          className="th-sort"
                          /* Tên gọi phải NÓI RÕ đây là nút sắp xếp. Nếu chỉ để nguyên tên cột,
                             màn nào có ô lọc trùng tên cột (vd "Loại" ở Phần mềm) sẽ có hai nút
                             cùng tên với hai nghĩa khác nhau — người dùng trình đọc màn hình
                             nghe "Loại, nút" hai lần mà không biết cái nào làm gì. */
                          aria-label={
                            typeof h.column.columnDef.header === 'string'
                              ? t('common.sortBy', { column: h.column.columnDef.header })
                              : undefined
                          }
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {/* Cùng nét chevron với dropdown, không phải ▲▼ của bộ ký tự —
                              hai loại mũi tên trên cùng một bảng đọc như hai hệ thống. */}
                          {/* Cột CHƯA sắp vẫn có mũi tên, ẩn tới khi rê chuột/focus: không có nó
                              thì cột sắp được trông y hệt cột không sắp được. */}
                          {sorted ? (
                            <span className="sort-arrow">
                              <Chevron direction={sorted === 'asc' ? 'up' : 'down'} />
                            </span>
                          ) : (
                            <span className="sort-arrow idle" aria-hidden="true">
                              <Chevron direction="down" />
                            </span>
                          )}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && loading ? (
              <SkeletonRows
                columns={
                  table.getAllLeafColumns().length + (renderExpanded ? 1 : 0) + (selection ? 1 : 0)
                }
              />
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    table.getAllLeafColumns().length +
                    (renderExpanded ? 1 : 0) +
                    (selection ? 1 : 0)
                  }
                >
                  <div className="empty">{emptyText}</div>
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const rowCanExpand =
                  !!renderExpanded && (canExpand?.(row.original) ?? true);
                const expanded = rowCanExpand && expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    {groupBy && starts?.[rowIndex] ? (
                      <tr className="row-group">
                        <th scope="rowgroup" colSpan={columnCount}>
                          {groupBy.label(groupBy.key(row.original), row.original)}
                        </th>
                      </tr>
                    ) : null}
                    <tr
                      className={
                        [
                          onRowClick ? 'clickable' : '',
                          rowClassName?.(row.original) || '',
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      // Row click = TIỆN ÍCH CHUỘT. KHÔNG role=button/tabIndex ở <tr> vì
                      // hàng chứa control tương tác (checkbox/kebab/nút) → nested-interactive
                      // (axe serious). Keyboard/SR mở dòng qua nút thật ở ô Mã (cell-code-open).
                      onClick={
                        onRowClick
                          ? (event) => {
                              if (isInnerControlClick(event)) return;
                              onRowClick(row.original);
                            }
                          : undefined
                      }
                      style={onRowClick ? { cursor: 'pointer' } : undefined}
                    >
                      {selection && (
                        <td
                          className="sel"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={t('dataTable.selectRow')}
                            checked={selection.selected.has(row.id)}
                            onChange={() => selection.onToggle(row.id)}
                          />
                        </td>
                      )}
                      {renderExpanded && (
                        <td className="lead">
                          {rowNumberOffset != null && (
                            <span className="row-no">
                              {rowNumberOffset + rowIndex + 1}
                            </span>
                          )}
                          {/* Mũi tên bung dòng do BẢNG vẽ, không bắt mỗi màn tự dựng lại
                              trong ô đầu (nếp cũ của QLTS) — cột này vốn đã được chừa sẵn.
                              Chỉ vẽ khi dòng thật sự bung được: mũi tên bấm ra rỗng cũng là
                              một kiểu hứa hão. */}
                          {rowCanExpand ? (
                            <button
                              type="button"
                              className={expandText ? 'caret-btn caret-chip' : 'caret-btn'}
                              aria-expanded={expanded}
                              aria-controls={expandRegionId(row.id)}
                              aria-label={
                                expandLabel?.(row.original, expanded) ??
                                (expandText
                                  ? undefined
                                  : t(expanded ? 'common.collapseRow' : 'common.expandRow'))
                              }
                              onClick={(event) => {
                                // Không để lan lên `onRowClick` (mở trang chi tiết).
                                event.stopPropagation();
                                setExpandedId((cur) => (cur === row.id ? null : row.id));
                              }}
                            >
                              {/* Cùng nét mũi tên với dropdown/lịch — chỉ SANG PHẢI khi đóng,
                                  xoay xuống khi bung, đúng nếp cây thư mục. */}
                              {expandText ? <span>{expandText(row.original)}</span> : null}
                              <Chevron direction={expanded ? 'down' : 'right'} />
                            </button>
                          ) : null}
                        </td>
                      )}
                      {row.getVisibleCells().map((cell) => {
                        const h = cell.column.columnDef.header;
                        const cm = cell.column.columnDef.meta;
                        return (
                          <td
                            key={cell.id}
                            className={cellClass(
                              cm,
                              !!stickyActions && cell.column.id === lastColumnId,
                            )}
                            data-label={
                              typeof h === 'string' ? h : cell.column.id
                            }
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {expanded && renderExpanded && (
                      <tr className="exp">
                        <td
                          id={expandRegionId(row.id)}
                          colSpan={
                            row.getVisibleCells().length +
                            1 +
                            (selection ? 1 : 0)
                          }
                        >
                          {renderExpanded(row.original)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

/**
 * Danh sách thẻ gọn — phần điện thoại của `DataTable`, tách ra cho bảng VIẾT TAY dùng lại
 * (Kho thanh lý): cùng một kiểu thẻ ở mọi màn, không màn nào tự dựng `<li>` riêng.
 * `groupBy` kẻ một dòng tiêu đề trước thẻ đầu mỗi nhóm.
 */
export function MobileCardList<T>({
  rows,
  rowKey,
  card,
  rowClassName,
  onRowClick,
  groupBy,
}: {
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  card: MobileCard<T>;
  rowClassName?: (row: T) => string;
  onRowClick?: (row: T) => void;
  groupBy?: TableGroupBy<T>;
}) {
  const starts = groupBy ? groupStarts(rows, groupBy.key) : null;
  return (
    <ul className="list-cards">
      {rows.map((row, index) => (
        <Fragment key={rowKey(row, index)}>
          {groupBy && starts?.[index] ? (
            <li className="list-cards-group" role="presentation">
              <span role="heading" aria-level={3}>
                {groupBy.label(groupBy.key(row), row)}
              </span>
            </li>
          ) : null}
          <MobileCardItem
            row={row}
            card={card}
            className={rowClassName?.(row)}
            onRowClick={onRowClick}
          />
        </Fragment>
      ))}
    </ul>
  );
}

/**
 * Một thẻ gọn. Định danh là link/nút DUY NHẤT của thẻ và phủ cả thẻ bằng lớp `::after`
 * (`.list-card-link`), nên chạm đâu cũng mở — mà thẻ vẫn chỉ có một điểm dừng Tab và không
 * lồng tương tác. Badge, menu ⋯ và khe `aside` nằm TRÊN lớp phủ nên vẫn bấm riêng được.
 */
function MobileCardItem<T>({
  row,
  card,
  className,
  onRowClick,
}: {
  row: T;
  card: MobileCard<T>;
  className?: string;
  onRowClick?: (row: T) => void;
}) {
  const title = card.title(row);
  /* Tiêu đề xuống tối đa hai dòng rồi "…" (`.list-card-title`): chữ đủ nằm ở `title` khi nó là
     chuỗi — node tự dựng thì nơi gọi tự lo. */
  const titleText = typeof title === 'string' || typeof title === 'number' ? String(title) : undefined;
  const href = card.href?.(row);
  const badge = card.badge?.(row);
  const actions = card.actions?.(row);
  const subtitle = card.subtitle?.(row);
  const meta = card.meta?.(row);
  const aside = card.aside?.(row);
  return (
    <li className={['list-card', className].filter(Boolean).join(' ')}>
      <div className="list-card-top">
        <span className={card.titleIsCode ? 'list-card-title mono' : 'list-card-title'} title={titleText}>
          {href ? (
            <Link to={href} className="list-card-link">
              {title}
            </Link>
          ) : onRowClick ? (
            <button type="button" className="list-card-link" onClick={() => onRowClick(row)}>
              {title}
            </button>
          ) : (
            title
          )}
        </span>
        {badge || actions ? (
          <span className="list-card-end">
            {badge}
            {actions}
          </span>
        ) : null}
      </div>
      {subtitle ? <div className="list-card-sub">{subtitle}</div> : null}
      {meta || aside ? (
        <div className="list-card-bottom">
          <span className="list-card-meta">{meta}</span>
          {aside ? <span className="list-card-aside">{aside}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Lượt bấm dòng có phải rơi vào một điều khiển riêng trong dòng không.
 *
 * Link ở ô Mã: nếu dòng cũng điều hướng thì Ctrl+bấm vừa mở tab mới vừa nhảy trang ở tab này.
 * Menu ⋯ render qua PORTAL nhưng sự kiện React vẫn nổi qua cây component về `<tr>` — nên
 * đích bấm nằm ngoài DOM của dòng cũng phải bỏ qua. Người đang bôi đen chữ để chép cũng vậy.
 */
function isInnerControlClick(event: React.MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement;
  if (!event.currentTarget.contains(target)) return true;
  if (target.closest('a, button, input, select, textarea, label, [role="menu"]')) return true;
  return !!window.getSelection?.()?.toString();
}

/** Ô search debounce 200ms — không lọc lại mỗi phím, giữ gõ mượt trên bảng lớn. */
function SearchBox({
  onChange,
  placeholder,
}: {
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    const id = setTimeout(() => onChange(text), 200);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return (
    <input
      className="table-search"
      type="search"
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
