export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, code = 'BAD_REQUEST') => new HttpError(400, code, m);
export const unauthorized = (m = 'Authentification requise') => new HttpError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'Accès refusé') => new HttpError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Introuvable') => new HttpError(404, 'NOT_FOUND', m);
export const conflict = (m: string, code = 'CONFLICT', extra?: Record<string, unknown>) =>
  new HttpError(409, code, m, extra);
