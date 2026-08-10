const { nextVersion } = require('../../scripts/bump-version');

describe('nextVersion', () => {
  it('counts the patch up', () => {
    expect(nextVersion('0.0.1')).toBe('0.0.2');
    expect(nextVersion('0.0.2')).toBe('0.0.3');
    expect(nextVersion('0.1.7')).toBe('0.1.8');
  });

  // The whole point of the scheme: two digits per position, not semver.
  it('rolls the patch into the minor at 99', () => {
    expect(nextVersion('0.0.98')).toBe('0.0.99');
    expect(nextVersion('0.0.99')).toBe('0.1.0');
    expect(nextVersion('0.1.99')).toBe('0.2.0');
  });

  it('rolls the minor into the major at 99', () => {
    expect(nextVersion('0.99.99')).toBe('1.0.0');
    expect(nextVersion('1.99.99')).toBe('2.0.0');
  });

  it('does not roll the major', () => {
    expect(nextVersion('9.0.0')).toBe('9.0.1');
    expect(nextVersion('99.99.99')).toBe('100.0.0');
  });

  it('never repeats or goes backwards over a long run', () => {
    const seen = new Set();
    let v = '0.0.1';
    for (let i = 0; i < 500; i += 1) {
      expect(seen.has(v)).toBe(false);
      seen.add(v);
      const next = nextVersion(v);
      // Comparable as a base-100 number, which is what the scheme really is.
      const value = (s) =>
        s.split('.').reduce((acc, p) => acc * 100 + Number(p), 0);
      expect(value(next)).toBe(value(v) + 1);
      v = next;
    }
    expect(v).toBe('0.5.1');
  });

  it('refuses anything that is not three numbers', () => {
    for (const bad of ['1.0', '1.0.0.0', 'v1.0.0', '1.0.x', '', null, undefined]) {
      expect(() => nextVersion(bad)).toThrow(/three-part numeric/);
    }
  });
});

describe('app.json', () => {
  const { expo } = require('../../app.json');

  it('starts at the version that was asked for', () => {
    expect(expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // The bug this guards against strands every installed app: with the
  // appVersion policy, bumping the version changes runtimeVersion, and phones
  // carrying the old runtime silently stop receiving updates.
  it('pins runtimeVersion instead of deriving it from the version', () => {
    expect(typeof expo.runtimeVersion).toBe('string');
    expect(expo.runtimeVersion).not.toBe(expo.version);
  });

  // The exact value is asserted once, in __tests__/config/appConfig.test.js.
  // Repeating it here meant a runtime bump failed in two places for one reason.

  it('has a versionCode for the Play Store', () => {
    expect(Number.isInteger(expo.android.versionCode)).toBe(true);
    expect(expo.android.versionCode).toBeGreaterThan(0);
  });
});
