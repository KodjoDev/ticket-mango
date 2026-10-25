import type { OptionField, Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_LIST_COLUMNS,
  DEFAULT_PRIORITY_MATRIX,
  DEFAULT_SLA_POLICY,
  DEFAULT_TICKET_FORM,
  IMPACTS,
  LIST_COLUMNS,
  normalizeLayout,
  OPTION_FIELD_LABELS,
  PRIORITIES,
  TICKET_FORM_FIELDS,
  URGENCIES,
  type PriorityMatrix,
  type SlaPolicy,
} from '@ticketing/shared';
import { z } from 'zod';
import { badRequest } from '../lib/errors';

export const SETTING_KEYS = {
  priorityMatrix: 'priorityMatrix',
  ticketForm: 'ticketForm',
  listColumns: 'listColumns',
  slaPolicy: 'slaPolicy',
} as const;

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:MM');

export const slaPolicySchema = z
  .object({
    targets: z
      .object(
        Object.fromEntries(
          PRIORITIES.map((p) => [
            p,
            z
              .object({
                firstResponseMinutes: z.number().int().min(1).max(60 * 24 * 60),
                resolutionMinutes: z.number().int().min(1).max(60 * 24 * 365),
                calendar: z.enum(['ALWAYS', 'BUSINESS']),
              })
              .strict(),
          ]),
        ),
      )
      .strict(),
    businessHours: z
      .object({
        timeZone: z.string().refine((tz) => {
          try {
            new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, 'Fuseau horaire inconnu'),
        week: z
          .array(
            z
              .object({ start: hm, end: hm })
              .strict()
              .refine((d) => d.end > d.start, 'La fermeture doit suivre l’ouverture')
              .nullable(),
          )
          .length(7)
          .refine((week) => week.some(Boolean), 'Au moins un jour ouvré est nécessaire'),
        frenchHolidays: z.boolean(),
        closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
      })
      .strict(),
    warningPercent: z.number().int().min(10).max(99),
  })
  .strict() as unknown as z.ZodType<SlaPolicy>;

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

  async slaPolicy(): Promise<SlaPolicy> {
    const parsed = slaPolicySchema.safeParse(await this.setting(SETTING_KEYS.slaPolicy));
    return parsed.success ? parsed.data : DEFAULT_SLA_POLICY;
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
