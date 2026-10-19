# Third-party software

## MediaPipe Tasks Vision

`vendor/mediapipe/` contains the MediaPipe Tasks Vision runtime (`@mediapipe/tasks-vision`, version 1.1.1) from Google.
License: Apache License 2.0. https://github.com/google-ai-edge/mediapipe

## MediaPipe Pose Landmarker models

`models/pose_landmarker_lite.task`, `pose_landmarker_full.task` and `pose_landmarker_heavy.task` are Google's
standard MediaPipe Pose Landmarker model bundles.
License: Apache License 2.0. https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker

If a model file ever fails to load, the app falls back to the same models hosted by Google.
