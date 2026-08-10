// The alarm tones bundled with the app.
//
// Lives in its own module so that sounds.js (which adds the phone's own
// ringtones on top) and notifications.js (which schedules against them) can
// both use it without importing each other — that cycle leaves one of the two
// half-initialised at require time, which shows up as an undefined TONES array
// only in a release build.
//
// `sound` is the res/raw file name without extension. Each tone gets its own
// Android channel because a channel's sound cannot be changed once created.
export const TONES = [
  { id: 'classic', label: 'Classic', sound: 'alarm', channelId: 'pill-alarm-classic' },
  { id: 'chime', label: 'Chime', sound: 'chime', channelId: 'pill-alarm-chime' },
  { id: 'bell', label: 'Bell', sound: 'bell', channelId: 'pill-alarm-bell' },
  { id: 'siren', label: 'Siren', sound: 'siren', channelId: 'pill-alarm-siren' },
  { id: 'gentle', label: 'Gentle', sound: 'gentle', channelId: 'pill-alarm-gentle' },
];

export function toneById(id) {
  return TONES.find((t) => t.id === id) || TONES[0];
}
