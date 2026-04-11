import { ApiErrorResponse } from "../../../../shared/contracts";

export function appError(code: ApiErrorResponse["error"]["code"], message: string, status = 400) {
  return {
    status,
    body: {
      error: {
        code,
        message,
      },
    },
  };
}
