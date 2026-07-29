import { describe, expect, it } from 'vitest';
import { errorMessage } from './error';

describe('errorMessage', () => {
  it('preserves Error and Tauri string messages', () => {
    expect(errorMessage(new Error('JavaScript error'), 'Fallback')).toBe(
      'JavaScript error',
    );
    expect(
      errorMessage('configuration error: missing client ID', 'Fallback'),
    ).toBe('configuration error: missing client ID');
  });

  it('uses the fallback for empty or unknown rejections', () => {
    expect(errorMessage('', 'Fallback')).toBe('Fallback');
    expect(errorMessage({ message: 'unknown shape' }, 'Fallback')).toBe(
      'Fallback',
    );
  });
});
