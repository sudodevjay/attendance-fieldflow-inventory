/**
 * Photo from the camera or the gallery (react-native-image-picker). Android opens the phone's own camera app and the
 * system photo picker, so no camera / storage permission is needed. Returns null when the person cancelled.
 */
import { launchCamera, launchImageLibrary, type CameraOptions } from 'react-native-image-picker';

export interface Photo { uri: string; base64?: string }

export async function pickPhoto(o: { camera: boolean; front?: boolean; base64?: boolean; quality?: number }): Promise<Photo | null> {
  const opts: CameraOptions = {
    mediaType: 'photo', includeBase64: !!o.base64, quality: (o.quality ?? 0.6) as CameraOptions['quality'],
    cameraType: o.front ? 'front' : 'back', saveToPhotos: false,
  };
  const r = o.camera ? await launchCamera(opts) : await launchImageLibrary(opts);
  if (r.didCancel) return null;
  if (r.errorCode) {
    throw new Error(r.errorCode === 'camera_unavailable' ? 'The camera is not available on this phone.'
      : r.errorCode === 'permission' ? 'Allow the camera / photos permission for Housys Attendance (phone Settings → Apps).'
        : r.errorMessage || 'The photo could not be taken.');
  }
  const a = r.assets?.[0];
  return a?.uri ? { uri: a.uri, base64: a.base64 } : null;
}
