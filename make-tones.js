// Generates several distinct bundled alarm tones as 16-bit mono WAV files.
// These can be used as Android notification-channel sounds (res/raw), which a
// picked system ringtone URI cannot. Run: node make-tones.js
const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const durationSec = 4;
const numSamples = sampleRate * durationSec;

function writeWav(name, sampleFn) {
  const headerSize = 44;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(headerSize + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let v = sampleFn(t, i);
    v = Math.max(-1, Math.min(1, v));
    buffer.writeInt16LE(Math.floor(v * 32767), headerSize + i * 2);
  }
  const out = path.join(__dirname, 'assets', 'sounds', name + '.wav');
  fs.writeFileSync(out, buffer);
  console.log('Wrote', out, buffer.length, 'bytes');
}

const TWO_PI = Math.PI * 2;

// Chime: pleasant ascending 3-note motif with soft bell decay, repeating.
writeWav('chime', (t) => {
  const notes = [1046.5, 1318.5, 1568.0];
  const noteLen = 0.28;
  const period = 1.4;
  const p = t % period;
  const idx = Math.floor(p / noteLen);
  if (idx >= notes.length) return 0;
  const local = p - idx * noteLen;
  const env = Math.exp(-local * 6);
  return Math.sin(TWO_PI * notes[idx] * t) * env * 0.8;
});

// Bell: single bright note with long exponential decay, once per second.
writeWav('bell', (t) => {
  const period = 1.0;
  const local = t % period;
  const env = Math.exp(-local * 3.2);
  const f = 1568.0;
  const tone =
    Math.sin(TWO_PI * f * t) * 0.7 + Math.sin(TWO_PI * f * 2 * t) * 0.2;
  return tone * env * 0.9;
});

// Siren: frequency sweeps up and down continuously.
writeWav('siren', (t) => {
  const sweep = 600 + 500 * (0.5 + 0.5 * Math.sin(TWO_PI * 0.7 * t));
  return Math.sin(TWO_PI * sweep * t) * 0.8;
});

// Gentle: soft low double-beep, slow, easy on the ears.
writeWav('gentle', (t) => {
  const beepLen = 0.25;
  const period = 1.6;
  const p = t % period;
  let env = 0;
  if (p < beepLen) env = Math.sin((Math.PI * p) / beepLen);
  else if (p >= 0.35 && p < 0.35 + beepLen)
    env = Math.sin((Math.PI * (p - 0.35)) / beepLen);
  return Math.sin(TWO_PI * 660 * t) * env * 0.55;
});

console.log('Done.');
