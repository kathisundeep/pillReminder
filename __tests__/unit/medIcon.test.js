import { shade, luminance, isLight, edgeFor, detailFor } from '../../src/theme';
import { SHAPES } from '../../src/components/MedIcon';
import { MED_FORMS } from '../../src/theme';

describe('colour helpers', () => {
  it('lightens toward white and darkens toward black', () => {
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 0)).toBe('#808080');
  });

  it('accepts three-digit hex', () => {
    expect(shade('#fff', 0)).toBe('#ffffff');
  });

  it('falls back to a neutral rather than throwing on junk', () => {
    for (const bad of ['', 'nonsense', null, undefined, '#12']) {
      expect(shade(bad, 0)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('rates white as light and black as dark', () => {
    expect(isLight('#FFFFFF')).toBe(true);
    expect(isLight('#000000')).toBe(false);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 1);
  });

  // A white tablet on a white card is invisible without this.
  it('gives even white a visibly darker edge', () => {
    const edge = edgeFor('#FFFFFF');
    expect(edge).not.toBe('#FFFFFF');
    expect(luminance(edge)).toBeLessThan(0.85);
  });

  it('picks a detail colour that contrasts with its fill', () => {
    expect(luminance(detailFor('#FFFFFF'))).toBeLessThan(luminance('#FFFFFF'));
    expect(luminance(detailFor('#101010'))).toBeGreaterThan(luminance('#101010'));
  });
});

describe('medicine shapes', () => {
  // The reported bug: tablet and capsule were the same 💊 glyph.
  it('draws a distinct shape for every form', () => {
    const names = Object.keys(SHAPES);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining(['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops'])
    );
  });

  it('has a shape for every form the picker offers', () => {
    for (const form of MED_FORMS) {
      expect(SHAPES[form.id]).toBeDefined();
    }
  });

  it('gives tablet and capsule genuinely different renderers', () => {
    expect(SHAPES.Tablet).not.toBe(SHAPES.Capsule);
  });
});
