import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  takeMedicinePhoto,
  pickMedicinePhoto,
  photoUri,
  photoSizeLabel,
} from '../../src/utils/photo';

const MAX_BASE64_CHARS = 12000;

describe('photoUri', () => {
  it('wraps a base64 string in a JPEG data URI', () => {
    expect(photoUri('abc')).toBe('data:image/jpeg;base64,abc');
  });

  it('returns null for an absent photo so <Image> is not rendered', () => {
    expect(photoUri(null)).toBeNull();
    expect(photoUri(undefined)).toBeNull();
    expect(photoUri('')).toBeNull();
  });
});

describe('photoSizeLabel', () => {
  it('converts base64 length to approximate KB', () => {
    // 12000 base64 chars ≈ 9000 bytes ≈ 9 KB
    expect(photoSizeLabel('x'.repeat(12000))).toBe('9 KB');
    expect(photoSizeLabel('x'.repeat(4000))).toBe('3 KB');
  });

  it('is empty for no photo', () => {
    expect(photoSizeLabel(null)).toBe('');
    expect(photoSizeLabel('')).toBe('');
  });
});

describe('takeMedicinePhoto', () => {
  it('asks for camera permission before opening the camera', async () => {
    await takeMedicinePhoto();
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
  });

  it('reports a clear error and never opens the camera when denied', async () => {
    ImagePicker.__state.cameraPermission = { granted: false };
    const res = await takeMedicinePhoto();
    expect(res).toEqual({ ok: false, error: 'Camera permission denied' });
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('reports cancellation distinctly from failure', async () => {
    ImagePicker.__state.result = { canceled: true, assets: [] };
    expect(await takeMedicinePhoto()).toEqual({ ok: false, canceled: true });
  });

  it('treats an empty assets array as a cancellation', async () => {
    ImagePicker.__state.result = { canceled: false, assets: [] };
    expect(await takeMedicinePhoto()).toEqual({ ok: false, canceled: true });
  });

  it('requests a square, pre-compressed capture', async () => {
    await takeMedicinePhoto();
    const opts = ImagePicker.launchCameraAsync.mock.calls[0][0];
    expect(opts.allowsEditing).toBe(true);
    expect(opts.aspect).toEqual([1, 1]);
    expect(opts.mediaTypes).toBe('Images');
  });
});

describe('pickMedicinePhoto', () => {
  it('asks for library permission before opening the gallery', async () => {
    await pickMedicinePhoto();
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
  });

  it('reports a clear error when photo access is denied', async () => {
    ImagePicker.__state.libraryPermission = { granted: false };
    const res = await pickMedicinePhoto();
    expect(res).toEqual({ ok: false, error: 'Photo access denied' });
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('shares the compression path with the camera', async () => {
    const res = await pickMedicinePhoto();
    expect(res.ok).toBe(true);
    expect(res.photo.length).toBeLessThanOrEqual(MAX_BASE64_CHARS);
  });
});

describe('compression budget', () => {
  it('stops at the first step that fits the ~9 KB budget', async () => {
    // Mock sizes: 400px->30000, 320px->18000, 256px->9000 (first under 12000).
    const res = await takeMedicinePhoto();
    expect(res.ok).toBe(true);
    expect(res.photo.length).toBe(9000);

    const widths = ImageManipulator.__state.calls.map((c) => c.width);
    expect(widths).toEqual([400, 320, 256]); // 192 never needed
  });

  it('returns immediately when the very first step already fits', async () => {
    ImageManipulator.__state.sizeForWidth = { 400: 5000 };
    const res = await takeMedicinePhoto();
    expect(res.photo.length).toBe(5000);
    expect(ImageManipulator.__state.calls.map((c) => c.width)).toEqual([400]);
  });

  it('keeps the smallest result rather than losing the photo when nothing fits', async () => {
    // A very noisy image: even the harshest step overshoots the budget.
    ImageManipulator.__state.sizeForWidth = {
      400: 90000,
      320: 60000,
      256: 40000,
      192: 20000,
    };
    const res = await takeMedicinePhoto();
    expect(res.ok).toBe(true);
    expect(res.photo.length).toBe(20000); // the last (smallest) step
    expect(ImageManipulator.__state.calls.map((c) => c.width)).toEqual([
      400, 320, 256, 192,
    ]);
  });

  it('stays under the 60 000-char database constraint even in the worst case', async () => {
    ImageManipulator.__state.sizeForWidth = {
      400: 90000,
      320: 60000,
      256: 40000,
      192: 20000,
    };
    const res = await takeMedicinePhoto();
    // supabase/schema.sql: check (photo is null or char_length(photo) <= 60000)
    expect(res.photo.length).toBeLessThanOrEqual(60000);
  });

  it('compresses to JPEG and asks for base64 at every step', async () => {
    await takeMedicinePhoto();
    for (const call of ImageManipulator.__state.calls) {
      expect(call.opts.format).toBe('jpeg');
      expect(call.opts.base64).toBe(true);
      expect(call.opts.compress).toBeLessThanOrEqual(0.5);
    }
  });

  it('lowers quality as it lowers resolution', async () => {
    ImageManipulator.__state.sizeForWidth = {
      400: 90000, 320: 60000, 256: 40000, 192: 20000,
    };
    await takeMedicinePhoto();
    const q = ImageManipulator.__state.calls.map((c) => c.opts.compress);
    expect(q).toEqual([...q].sort((a, b) => b - a)); // monotonically decreasing
  });

  // Was BUG-18: this returned { ok: true, photo: null }, so the screen silently
  // did nothing and the button looked broken.
  it('reports a clear failure when no base64 comes back', async () => {
    ImageManipulator.__state.omitBase64 = true;
    const res = await takeMedicinePhoto();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not process/i);
  });

  it('reports the same failure from the gallery path', async () => {
    ImageManipulator.__state.omitBase64 = true;
    const res = await pickMedicinePhoto();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not process/i);
  });
});
