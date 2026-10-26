import { screen } from '@testing-library/react';
import type { PublicRelease } from './api/types';
import { mockApi, renderApp } from './test/utils';

describe('release notes', () => {
  it('affiche le portail public par catégorie, sans connexion', async () => {
    const releases: PublicRelease[] = [
      { id: 'r1', version: '2.0.0', title: 'Grosse version', publishedAt: '2026-10-26T09:00:00Z', sections: [{ category: 'FIX', items: [{ text: 'La connexion ne plante plus.' }] }] },
    ];
    mockApi({ 'GET /public/releases': releases });
    renderApp('/releases');
    expect(await screen.findByText(/Version 2\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText('Corrections')).toBeInTheDocument();
    expect(screen.getByText('La connexion ne plante plus.')).toBeInTheDocument();
  });

  it('indique l’absence de version publiée', async () => {
    mockApi({ 'GET /public/releases': [] });
    renderApp('/releases');
    expect(await screen.findByText('Aucune version publiée pour le moment.')).toBeInTheDocument();
  });
});
