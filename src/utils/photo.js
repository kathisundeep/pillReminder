import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

// Medicine photos — deliberately tiny.
//
// A phone camera hands us a 5-50 MB original, but the photo is only ever shown
// as a list thumbnail or a ~220pt square on the alarm screen. So we crop to a
// square, downscale, and re-compress until the base64 payload fits the budget
// below, then store that string straight on the medicine row. No storage
// bucket, no signed URLs, and the photo rides along in the offline medicines
// cache so it still shows when the alarm fires with no network.
//
// Budget: 12 000 base64 chars ≈ 9 KB of JPEG ≈ 12 KB of text in Postgres.
// 1000 medicines with photos ≈ 12 MB total.
const MAX_BASE64_CHARS = 12000;

// Tried in order; the first result under budget wins. Photos of a pill strip or
// a syrup bottle label are low-detail, so even the last step stays readable.
const STEPS = [
  { size: 400, quality: 0.5 },
  { size: 320, quality: 0.42 },
  { size: 256, quality: 0.35 },
  { size: 192, quality: 0.3 },
];

async function shrink(uri) {
  let smallest = null;
  for (const step of STEPS) {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: step.size } }],
      {
        compress: step.quality,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      }
    );
    smallest = out.base64 || smallest;
    if (out.base64 && out.base64.length <= MAX_BASE64_CHARS) return out.base64;
  }
  // Even the harshest step overshot (very noisy photo) — it's still only a few
  // KB more, so keep it rather than losing the user's picture.
  return smallest;
}

// Compression can come back with nothing at all (a manipulator that returns no
// base64). Reporting that as ok:true with a null photo made the caller silently
// do nothing, which reads to the user as the button being broken.
function finish(photo) {
  if (!photo) {
    return { ok: false, error: 'Could not process that photo. Please try again.' };
  }
  return { ok: true, photo };
}

// Launch the camera. Returns a base64 JPEG string, or null if the user
// cancelled or denied permission.
export async function takeMedicinePhoto() {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Camera permission denied' };
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7, // first pass; shrink() does the real compression
  });
  if (res.canceled || !res.assets?.length) return { ok: false, canceled: true };
  return finish(await shrink(res.assets[0].uri));
}

// Pick an existing photo from the gallery. Same return shape as above.
export async function pickMedicinePhoto() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Photo access denied' };
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  if (res.canceled || !res.assets?.length) return { ok: false, canceled: true };
  return finish(await shrink(res.assets[0].uri));
}

// Turn a stored base64 string into something <Image source> accepts.
export function photoUri(photo) {
  if (!photo) return null;
  return `data:image/jpeg;base64,${photo}`;
}

// Rough on-disk size of a stored photo, for the "Photo · 9 KB" hint.
export function photoSizeLabel(photo) {
  if (!photo) return '';
  return `${Math.round((photo.length * 3) / 4 / 1024)} KB`;
}
