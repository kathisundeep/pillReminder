import { TONES, toneById } from '../../src/utils/notifications';

describe('TONES catalog', () => {
  it('offers the five bundled tones', () => {
    expect(TONES.map((t) => t.id)).toEqual([
      'classic',
      'chime',
      'bell',
      'siren',
      'gentle',
    ]);
  });

  it('gives every tone an id, label, sound file and its own channel', () => {
    for (const tone of TONES) {
      expect(typeof tone.id).toBe('string');
      expect(typeof tone.label).toBe('string');
      expect(typeof tone.sound).toBe('string');
      expect(tone.channelId).toBe(`pill-alarm-${tone.id}`);
    }
  });

  it('uses a distinct channel per tone', () => {
    // An Android channel's sound is immutable once created, so two tones
    // sharing a channel would silently play the wrong sound.
    const channels = TONES.map((t) => t.channelId);
    expect(new Set(channels).size).toBe(TONES.length);
  });

  it('uses a distinct sound file per tone', () => {
    const sounds = TONES.map((t) => t.sound);
    expect(new Set(sounds).size).toBe(TONES.length);
  });
});

describe('toneById', () => {
  it('resolves each known id', () => {
    for (const tone of TONES) {
      expect(toneById(tone.id)).toBe(tone);
    }
  });

  it('falls back to Classic for unknown, missing or malformed ids', () => {
    for (const bad of [undefined, null, '', 'nope', 0, false, {}]) {
      expect(toneById(bad).id).toBe('classic');
    }
  });

  it('is case sensitive (ids are stored verbatim)', () => {
    expect(toneById('Bell').id).toBe('classic');
  });
});
