/**
 * Champs personnalisés du ticket : définis par l'administrateur, valeurs stockées par clé.
 */

export const CUSTOM_FIELD_KINDS = ['TEXT', 'LONGTEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX'] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

export const CUSTOM_FIELD_KIND_LABELS: Record<CustomFieldKind, string> = {
  TEXT: 'Texte court',
  LONGTEXT: 'Texte long',
  NUMBER: 'Nombre',
  DATE: 'Date',
  SELECT: 'Liste de choix',
  CHECKBOX: 'Case à cocher',
};

/** Clé stable d'un champ : minuscules, chiffres et tirets bas. */
export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export const MAX_TEXT_LENGTH = 500;
export const MAX_LONGTEXT_LENGTH = 5000;

export type CustomValue = string | number | boolean | null;
export type CustomValues = Record<string, CustomValue>;

export interface CustomFieldDef {
  key: string;
  label: string;
  kind: CustomFieldKind;
  required: boolean;
  /** Choix d'une liste (kind SELECT). */
  options: string[];
}

export type CustomValueResult = { ok: true; value: CustomValue } | { ok: false; error: string };

const isEmpty = (raw: unknown) => raw === null || raw === undefined || raw === '';

/**
 * Contrôle et normalise la valeur d'un champ. Une valeur vide devient `null`
 * (la case à cocher vaut `false` quand elle est vide).
 */
export function checkCustomValue(field: CustomFieldDef, raw: unknown): CustomValueResult {
  const fail = (error: string): CustomValueResult => ({ ok: false, error: `« ${field.label} » : ${error}` });
  if (field.kind === 'CHECKBOX') {
    if (isEmpty(raw)) return { ok: true, value: false };
    return typeof raw === 'boolean' ? { ok: true, value: raw } : fail('oui ou non attendu');
  }
  if (isEmpty(raw) || (typeof raw === 'string' && raw.trim() === '')) {
    return field.required ? fail('valeur obligatoire') : { ok: true, value: null };
  }
  switch (field.kind) {
    case 'TEXT':
    case 'LONGTEXT': {
      const max = field.kind === 'TEXT' ? MAX_TEXT_LENGTH : MAX_LONGTEXT_LENGTH;
      if (typeof raw !== 'string') return fail('texte attendu');
      return raw.trim().length > max ? fail(`${max} caractères au plus`) : { ok: true, value: raw.trim() };
    }
    case 'NUMBER':
      return typeof raw === 'number' && Number.isFinite(raw) ? { ok: true, value: raw } : fail('nombre attendu');
    case 'DATE':
      return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw))
        ? { ok: true, value: raw }
        : fail('date AAAA-MM-JJ attendue');
    case 'SELECT':
      return typeof raw === 'string' && field.options.includes(raw) ? { ok: true, value: raw } : fail('choix inconnu');
  }
}

/** Une case à cocher n'est jamais « obligatoire » : elle vaut simplement oui ou non. */
export function isFilled(value: CustomValue | undefined): boolean {
  return value !== null && value !== undefined && value !== '';
}
