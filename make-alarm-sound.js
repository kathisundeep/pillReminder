const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const durationSec = 4;
const numSamples = sampleRate * durationSec;

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

const beepLen = 0.18;
const gapLen = 0.10;
const cycleSamples = (beepLen + gapLen) * sampleRate;

for (let i = 0; i < numSamples; i++) {
  const cyclePos = i % cycleSamples;
  const inBeep = cyclePos < beepLen * sampleRate;
  let value = 0;
  if (inBeep) {
    const freq = (Math.floor(i / (cycleSamples * 2)) % 2 === 0) ? 880 : 1100;
    const env = Math.sin((Math.PI * cyclePos) / (beepLen * sampleRate));
    value = Math.sin((2 * Math.PI * freq * i) / sampleRate) * env;
  }
  const sample = Math.max(-1, Math.min(1, value * 0.85));
  buffer.writeInt16LE(Math.floor(sample * 32767), headerSize + i * 2);
}

const out = path.join(__dirname, 'assets', 'sounds', 'alarm.wav');
fs.writeFileSync(out, buffer);
console.log('Wrote', out, '-', buffer.length, 'bytes');
