import type { FastifyRequest } from 'fastify';
import type { IncomingFile } from '../services/attachments';

/** Lit un formulaire multipart entier : champs texte et fichiers (limites fixées à l'enregistrement du plugin). */
export async function readMultipart(request: FastifyRequest) {
  const fields: Record<string, string> = {};
  const files: (IncomingFile & { field: string })[] = [];
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      files.push({ field: part.fieldname, filename: part.filename, contentType: part.mimetype, data: await part.toBuffer() });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fields, files };
}
