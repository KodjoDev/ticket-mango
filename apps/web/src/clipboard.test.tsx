import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipboardProvider } from './clipboard/ClipboardContext';
import { copyText } from './clipboard/copy';
import { ClipboardPanel } from './components/ClipboardPanel';

function select(text: string) {
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text } as Selection);
  act(() => {
    document.dispatchEvent(new Event('copy'));
  });
}

const renderPanel = (userId = 'u1') =>
  render(
    <ClipboardProvider userId={userId}>
      <ClipboardPanel />
    </ClipboardProvider>,
  );

describe('historique des copies', () => {
  beforeEach(() => localStorage.clear());

  it('enregistre les copies, sans doublon, la plus récente en premier', async () => {
    renderPanel();
    select('premier');
    select('second');
    select('premier');
    await userEvent.click(screen.getByRole('button', { name: /Historique des copies/ }));
    const items = screen.getAllByText(/premier|second/).map((e) => e.textContent);
    expect(items).toEqual(['premier', 'second']);
  });

  it('recopie un élément dans le presse-papiers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderPanel();
    select('ticket #42');
    await userEvent.click(screen.getByRole('button', { name: /Historique des copies/ }));
    await userEvent.click(screen.getByText('ticket #42'));
    expect(writeText).toHaveBeenCalledWith('ticket #42');
    expect(await screen.findByText('Copié ✓')).toBeInTheDocument();
  });

  it('ignore un champ mot de passe et une sélection vide', () => {
    renderPanel();
    const input = document.createElement('input');
    input.type = 'password';
    input.value = 'secret';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 6);
    act(() => {
      document.dispatchEvent(new Event('copy'));
    });
    select('   ');
    expect(localStorage.length).toBe(0);
    input.remove();
  });

  it('conserve l’historique par utilisateur et permet de tout effacer', async () => {
    const { unmount } = renderPanel('u1');
    select('à garder');
    unmount();
    const second = renderPanel('u2');
    await userEvent.click(screen.getByRole('button', { name: /Historique des copies/ }));
    expect(screen.queryByText('à garder')).not.toBeInTheDocument();
    second.unmount();

    renderPanel('u1');
    await userEvent.click(screen.getByRole('button', { name: /Historique des copies/ }));
    expect(screen.getByText('à garder')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tout effacer'));
    expect(localStorage.getItem('ticket-mango:clipboard:u1')).toBeNull();
  });

  it('replie sur execCommand quand l’API moderne échoue', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('refusé')) } });
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('x')).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
