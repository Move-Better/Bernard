// WS6 auto-reframe — detect the presenter's face in a video frame (MediaPipe,
// client-side, lazy-loaded on first use) so the crop can centre on them. The
// WASM + model load from the MediaPipe CDN (this app sets no CSP, so nothing
// blocks it). Everything is wrapped so any failure degrades to manual reframe.

let _detectorP = null

async function getDetector() {
  if (_detectorP) return _detectorP
  _detectorP = (async () => {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm')
    return FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
      },
      runningMode: 'IMAGE',
    })
  })().catch((e) => { _detectorP = null; throw e })
  return _detectorP
}

// Detect the largest face in a <video> element and return its centre-x as a
// fraction (0..1) of the frame, or null if there's no face / the video frame
// isn't ready.
export async function detectFaceCenterX(videoEl) {
  if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return null
  const det = await getDetector()
  const canvas = document.createElement('canvas')
  canvas.width = videoEl.videoWidth
  canvas.height = videoEl.videoHeight
  canvas.getContext('2d').drawImage(videoEl, 0, 0)
  const res = det.detect(canvas)
  const faces = res?.detections || []
  if (!faces.length) return null
  const biggest = faces.reduce((a, b) => {
    const ba = a.boundingBox, bb = b.boundingBox
    return (ba.width * ba.height >= bb.width * bb.height) ? a : b
  })
  const bb = biggest.boundingBox
  const cx = (bb.originX + bb.width / 2) / canvas.width
  return Math.max(0, Math.min(1, cx))
}
