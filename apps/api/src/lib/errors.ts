/** Erreur métier traduite telle quelle en réponse HTTP par le gestionnaire d'erreurs. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message = 'Ressource introuvable') => new HttpError(404, message);
export const forbidden = (message = 'Permission insuffisante') => new HttpError(403, message);
export const conflict = (message: string) => new HttpError(409, message);
export const badRequest = (message: string) => new HttpError(400, message);
