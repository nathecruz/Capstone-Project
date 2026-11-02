// The photo that proves a check-in (backend/services/check-in-proof.js): taken with the camera at
// the check-in, never picked from the gallery, and made small, since the server takes at most 300 KB
// and keeps it a few weeks for review.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { CheckInProof } from '@/authentication/authService';

// Tried in order until the photo is small enough.
const SIZES = [{ side: 800, compress: 0.6 }, { side: 640, compress: 0.45 }, { side: 480, compress: 0.35 }];
/** Base64 of 300 KB, the most the server takes. */
const MAX_BASE64_LENGTH = 400_000;

/** null when the student closed the camera without a photo. */
export type ProofPhoto = { ok: true; proof: CheckInProof } | { ok: false; message: string } | null;

export async function takeProofPhoto(): Promise<ProofPhoto> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, message: 'Allow camera access to take the photo that proves this check-in.' };
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return null;
    for (const { side, compress } of SIZES) {
      const context = ImageManipulator.manipulate(asset.uri);
      if (!asset.width || !asset.height || Math.max(asset.width, asset.height) > side) context.resize(asset.height > asset.width ? { height: side } : { width: side });
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ base64: true, compress, format: SaveFormat.JPEG });
      if (saved.base64 && saved.base64.length <= MAX_BASE64_LENGTH) return { ok: true, proof: { photo: saved.base64, type: 'image/jpeg' } };
    }
    return { ok: false, message: 'The photo could not be made small enough. Try again.' };
  } catch {
    return { ok: false, message: 'The camera could not be opened. Try again.' };
  }
}
