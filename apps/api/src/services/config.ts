import type { OptionField, Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_LIST_COLUMNS,
  DEFAULT_PRIORITY_MATRIX,
  DEFAULT_TICKET_FORM,
  IMPACTS,
  LIST_COLUMNS,
  normalizeLayout,
  OPTION_FIELD_LABELS,
  PRIORITIES,
  TICKET_FORM_FIELDS,
  URGENCIES,
  type PriorityMatrix,
} from '@ticketing/shared';
import { z } from 'zod';
import { badRequest } from '../lib/errors';

export const SETTING_KEYS = {
  priorityMatrix: 'priorityMatrix',
  ticketForm: 'ticketForm',
  listColumns: 'listColumns',
} as const;

export const priorityMatrixSchema = z.object(
  Object.fromEntries(
    IMPACTS.map((impact) => [
      impact,
      z.object(Object.fromEntries(URGENCIES.map((urgency) => [urgency, z.enum(PRIORITIES)]))).strict(),
    ]),
  ),
).strict() as unknown as z.ZodType<PriorityMatrix>;

type Db = PrismaClient | Prisma.TransactionClient;

/** Réglages et listes administrables. Lus à chaque requête : volumes faibles, pas de cache à invalider. */
export class ConfigService {
  constructor(private readonly prisma: PrismaClient) {}

  private async setting(key: string): Promise<unknown> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value ?? null;
  }

  async priorityMatrix(): Promise<PriorityMatrix> {
    const parsed = priorityMatrixSchema.safeParse(await this.setting(SETTING_KEYS.priorityMatrix));
    return parsed.success ? parsed.data : DEFAULT_PRIORITY_MATRIX;
  }

  async ticketForm() {
    const saved = await this.setting(SETTING_KEYS.ticketForm);
    return saved ? normalizeLayout(saved, TICKET_FORM_FIELDS) : DEFAULT_TICKET_FORM;
  }

  async listColumns() {
    const saved = await this.setting(SETTING_KEYS.listColumns);
    return saved ? normalizeLayout(saved, LIST_COLUMNS) : DEFAULT_LIST_COLUMNS;
  }

  async saveSetting(db: Db, key: string, value: Prisma.InputJsonValue) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  options() {
    return this.prisma.fieldOption.findMany({ orderBy: [{ field: 'asc' }, { position: 'asc' }] });
  }

  /**
   * Une valeur de liste doit exister et être active ; conserver la valeur actuelle
   * d'un ticket reste permis même si elle a été archivée depuis.
   */
  async assertOptionUsable(field: OptionField, key: string | null | undefined, current?: string | null) {
    if (key === undefined || key === null || key === current) return;
    const option = await this.prisma.fieldOption.findUnique({ where: { field_key: { field, key } } });
    if (!option || !option.isActive) {
      throw badRequest(`Valeur inconnue ou archivée dans « ${OPTION_FIELD_LABELS[field]} » : ${key}`);
    }
  }

  /** Mêmes règles pour les tags : les nouveaux doivent exister et être actifs. */
  async assertTagsUsable(tagIds: string[], current: string[] = []) {
    const added = tagIds.filter((id) => !current.includes(id));
    if (added.length === 0) return;
    const tags = await this.prisma.tag.findMany({ where: { id: { in: added }, isActive: true } });
    if (tags.length !== new Set(added).size) throw badRequest('Tag inconnu ou archivé');
  }
}
