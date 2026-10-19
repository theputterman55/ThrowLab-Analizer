# Changelog

Versions use MAJOR.MINOR.PATCH (semantic versioning).

- **MAJOR** changes when something big is reworked or old saved sessions may stop working.
- **MINOR** changes when a new feature or tool is added.
- **PATCH** changes for fixes and small tweaks that add nothing new.

The current version is shown next to the ThrowLab name (top left) and is set in `index.html` (`window.__TL_VERSION`). Changing it also forces browsers to load the new code.

## 1.3.1
- Fix: the main script is now version-stamped too, so an update can never serve an old copy of it.

## 1.3.0
- Your work is kept when you refresh or update: clips, drawings, boxes, release marks, body tracking, frame position, layout and hand. Stored in this browser only.
- New "Saved work" section in the side panel: on/off switch and Clear saved work.
- Cache busting: each new version loads fresh code instead of an old cached copy.

## 1.2.1
- Zoom now fills the whole viewing window instead of the video box; pan stops at the video edge.
- Pinch and Ctrl+scroll stay inside the app and no longer zoom the browser page. Two-finger touch pinch added.
- Version number shown beside the ThrowLab name.

## 1.2.0
- Zoom and pan: cursor-centered pinch/scroll zoom, corner control with slider, +/-, Fit, Hold and zoom-window button.

## 1.1.0
- Layout picker, handedness, drawing tools, split-screen compare, MediaPipe body tracking, session save/load.

## 1.0.0
- First build of ThrowLab Analyzer.
