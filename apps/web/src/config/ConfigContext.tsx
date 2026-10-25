import { useQuery } from '@tanstack/react-query';
import type { OptionField } from '@ticketing/shared';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from '../api/client';
import type { AppConfig, FieldOption, Tag } from '../api/types';
import { ErrorMessage, Spinner } from '../components/ui';

export interface ConfigHelpers extends AppConfig {
  /** Libellé d'une clé de liste ; la clé brute si la valeur a disparu. */
  label: (field: OptionField, key: string | null | undefined) => string;
  /** Valeurs proposables : actives, plus la valeur actuelle même si elle est archivée. */
  choices: (field: OptionField, current?: string | null) => FieldOption[];
  /** Tags proposables : actifs, plus ceux déjà posés. */
  tagChoices: (currentIds?: string[]) => Tag[];
}

const ConfigContext = createContext<ConfigHelpers | null>(null);

export const CONFIG_QUERY_KEY = ['config'];

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data, error } = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: api.config, staleTime: 60_000 });

  const value = useMemo<ConfigHelpers | null>(() => {
    if (!data) return null;
    const byField = (field: OptionField) => data.options.filter((o) => o.field === field);
    return {
      ...data,
      label: (field, key) => (key ? (byField(field).find((o) => o.key === key)?.label ?? key) : '—'),
      choices: (field, current) => byField(field).filter((o) => o.isActive || o.key === current),
      tagChoices: (currentIds = []) => data.tags.filter((t) => t.isActive || currentIds.includes(t.id)),
    };
  }, [data]);

  if (error) return <ErrorMessage error={error} />;
  if (!value) return <Spinner label="Chargement de la configuration…" />;
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigHelpers {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig doit être utilisé dans <ConfigProvider>');
  return ctx;
}
