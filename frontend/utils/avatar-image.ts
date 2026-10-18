// The profile picture as it is saved and synced: a small JPEG data URI.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

/** Longest side of the saved picture, in pixels: sharp in the largest avatar, a few KB to sync. */
const AVATAR_SIZE = 256;

/**
 * The picker's own uri (a blob: URL on the web, a cache file on phones) only works on this device
 * until the app reloads, so the avatar went blank after a reload and on every other device. The
 * picked photo is saved as a small JPEG data URI instead, which shows wherever it syncs to.
 */
export async function toAvatarDataUri(asset: Pick<ImagePickerAsset, 'uri' | 'width' | 'height'>) {
  const context = ImageManipulator.manipulate(asset.uri);
  if (!asset.width || !asset.height || Math.max(asset.width, asset.height) > AVATAR_SIZE) {
    context.resize(asset.height > asset.width ? { height: AVATAR_SIZE } : { width: AVATAR_SIZE });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
  if (!result.base64) throw new Error('The photo could not be read.');
  return `data:image/jpeg;base64,${result.base64}`;
}
