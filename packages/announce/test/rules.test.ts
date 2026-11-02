import { describe, expect, it } from 'vitest';
import { allowedDisplays, closeableIsChoice, resolveDisplay } from '../src/core/rules.js';

describe('display rules', () => {
  it('lets each kind show only where the note says', () => {
    expect(allowedDisplays('announcement')).toEqual(['banner', 'popup']);
    expect(allowedDisplays('maintenance')).toEqual(['banner', 'popover']);
    expect(allowedDisplays('news')).toEqual(['sidebar']);
    expect(resolveDisplay('news', 'popup')).toEqual({
      ok: false,
      error: 'A news message shows as sidebar, not as popup.',
    });
  });

  it('fixes closeable where the display decides it', () => {
    expect(resolveDisplay('announcement', 'banner', false)).toMatchObject({ ok: true, closeable: true });
    expect(resolveDisplay('announcement', 'popup', false)).toMatchObject({ ok: true, closeable: true });
    expect(resolveDisplay('maintenance', 'banner', true)).toMatchObject({ ok: true, closeable: false });
  });

  it('leaves closeable to the admin for maintenance popovers', () => {
    expect(closeableIsChoice('maintenance', 'popover')).toBe(true);
    expect(closeableIsChoice('maintenance', 'banner')).toBe(false);
    expect(resolveDisplay('maintenance', 'popover', false)).toMatchObject({ ok: true, closeable: false });
    expect(resolveDisplay('maintenance', 'popover')).toMatchObject({ ok: true, closeable: true });
  });
});
