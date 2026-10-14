"use client";

export function TablePager({ page, totalPages, totalRows, pageSize, onPageChange, onPageSizeChange }: { page: number; totalPages: number; totalRows: number; pageSize: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void }) {
  return <div className="inventory-pagination" aria-label="表格分页"><span>共 {totalRows} 条</span><label>每页<select aria-label="每页显示数量" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value="10">10 条</option><option value="20">20 条</option><option value="50">50 条</option></select></label><button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button><b>{page} / {totalPages}</b><button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</button></div>;
}
