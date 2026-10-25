import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { SpellcheckIssue } from '../api/types';
import { ErrorMessage } from './ui';

const CATEGORY_LABELS: Record<string, string> = {
  TYPOS: 'Orthographe',
  GRAMMAR: 'Grammaire',
  PUNCTUATION: 'Ponctuation',
  TYPOGRAPHY: 'Typographie',
  CASING: 'Majuscules',
  CONFUSED_WORDS: 'Confusion',
  STYLE: 'Style',
  REDUNDANCY: 'Redondance',
};

/**
 * Applique une correction et recale les autres : décalage des positions suivantes,
 * abandon de celles qui chevauchaient le passage corrigé.
 */
export function applyReplacement(text: string, issues: SpellcheckIssue[], issue: SpellcheckIssue, replacement: string) {
  const next = text.slice(0, issue.offset) + replacement + text.slice(issue.offset + issue.length);
  const delta = replacement.length - issue.length;
  const end = issue.offset + issue.length;
  const remaining = issues
    .filter((i) => i !== issue && (i.offset + i.length <= issue.offset || i.offset >= end))
    .map((i) => (i.offset >= end ? { ...i, offset: i.offset + delta } : i));
  return { text: next, issues: remaining };
}

interface Props {
  text: string;
  onChange: (text: string) => void;
}

/** Vérification orthographique et grammaticale (LanguageTool) d'un message avant envoi. */
export function SpellcheckPanel({ text, onChange }: Props) {
  const [result, setResult] = useState<{ text: string; issues: SpellcheckIssue[] } | null>(null);
  const check = useMutation({
    mutationFn: () => api.spellcheck(text),
    onSuccess: ({ issues }) => setResult({ text, issues }),
  });
  // Le texte a été retouché depuis la vérification : les positions ne sont plus fiables.
  const stale = result !== null && result.text !== text;

  function fix(issue: SpellcheckIssue, replacement: string) {
    if (!result) return;
    const next = applyReplacement(result.text, result.issues, issue, replacement);
    setResult(next);
    onChange(next.text);
  }

  return (
    <div className="spellcheck">
      <button type="button" className="link" disabled={!text.trim() || check.isPending} onClick={() => check.mutate()}>
        {check.isPending ? 'Vérification…' : stale ? 'Revérifier' : 'Vérifier l’orthographe et la grammaire'}
      </button>
      <ErrorMessage error={check.error} />
      {result && !stale && (
        <div className="spellcheck-result" role="status">
          {result.issues.length === 0 ? (
            <p className="spellcheck-ok">Aucune faute détectée.</p>
          ) : (
            <ul>
              {result.issues.map((issue) => (
                <li key={`${issue.offset}-${issue.ruleId}`}>
                  <span className="spellcheck-category">{CATEGORY_LABELS[issue.category] ?? 'Suggestion'}</span>
                  <span className="spellcheck-excerpt">
                    {result.text.slice(Math.max(0, issue.offset - 20), issue.offset)}
                    <mark>{result.text.slice(issue.offset, issue.offset + issue.length)}</mark>
                    {result.text.slice(issue.offset + issue.length, issue.offset + issue.length + 20)}
                  </span>
                  <span className="muted small">{issue.message}</span>
                  {issue.replacements.length > 0 && (
                    <span className="spellcheck-fixes">
                      {issue.replacements.map((r) => (
                        <button key={r} type="button" onClick={() => fix(issue, r)}>
                          {r || '(supprimer)'}
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
