import { ApiResponse, PaginatedResult } from '@common/interfaces';

export function success<T>(data: T, message = 'Success'): ApiResponse<T> {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function created<T>(data: T, message = 'Created successfully'): ApiResponse<T> {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function paginated<T>(result: PaginatedResult<T>, message = 'Success'): ApiResponse<PaginatedResult<T>> {
  return {
    success: true,
    message,
    data: result,
    timestamp: new Date().toISOString(),
  };
}

export function error(message: string, errors?: string[]): ApiResponse<null> {
  return {
    success: false,
    message,
    errors,
    timestamp: new Date().toISOString(),
  };
}
