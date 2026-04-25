export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;

export function normalizePagination(page?: number, limit?: number) {
  const safePage = Number.isFinite(page) ? Math.max(1, Number(page)) : DEFAULT_PAGE;
  const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Number(limit))) : DEFAULT_LIMIT;
  const skip = (safePage - 1) * safeLimit;
  return { page: safePage, limit: safeLimit, skip };
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: totalPages > 0 && page < totalPages,
  };
}
