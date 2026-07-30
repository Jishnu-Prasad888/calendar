import { describe, expect, it } from 'vitest';
import { eventTextColor } from './color';

describe('eventTextColor', () => {
  it('uses dark text for light calendar colors', () => {
    expect(eventTextColor('#9adce1')).toBe('#000000');
    expect(eventTextColor('rgb(255, 235, 130)')).toBe('#000000');
  });

  it('uses light text for dark calendar colors', () => {
    expect(eventTextColor('#123456')).toBe('#ffffff');
    expect(eventTextColor('#000')).toBe('#ffffff');
  });
});
