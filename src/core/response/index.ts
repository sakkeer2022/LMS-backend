export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  meta?: PaginationMeta;
  errors?: Record<string, string[]>;
  traceId?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function successResponse<T>(
  data: T,
  message = 'Success',
  meta?: PaginationMeta
): ApiResponse<T> {
  return { success: true, message, data, ...(meta && { meta }) };
}

export function errorResponse(
  message: string,
  errors?: Record<string, string[]>,
  traceId?: string
): ApiResponse<never> {
  return { success: false, message, ...(errors && { errors }), ...(traceId && { traceId }) };
}
