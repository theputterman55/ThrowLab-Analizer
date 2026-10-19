# Changelog

Versions use MAJOR.MINOR.PATCH (semantic versioning).

- **MAJOR** changes when something big is reworked or old saved sessions may stop working.
- **MINOR** changes when a new feature or tool is added.
- **PATCH** changes for fixes and small tweaks that add nothing new.

The current version is shown next to the ThrowLab name (top left) and is set in `index.html` (`window.__TL_VERSION`). Changing it also forces browsers to load the new code.

## 1.5.1
- The pointer is an arrow while you place points with the Point labeler, including when zoomed in. (The pan hand was winning over it.) The Cursor tool still shows the hand when zoomed.
- The automatic body tracker is hidden: no skeleton, wrist trail, Follow box, tracked bands, Body tracking panel, Follow player tool or "Use tracker's points". Measurements, Layers (zoom window), Key moments, drawing tools and the Point labeler stay. Measurements now come only from the points you place.
- The tracker code is still in the files. Open the page with `?tracker=1` to bring it back (used by the tests).

## 1.5.0
- Point labeler: mark joints by hand. Pick Shoulders or Hips, click the two points, press D for the next frame (A goes back). Points carry forward; drag a dot only where the joint moves. That makes a keyframe, and frames between keyframes are blended.
- Finish (or Enter) locks the points from the first keyframe to the current frame; Edit reopens. On playback the points move along the person with a color-coded line and angle.
- Hand-placed points feed the measurements (shoulder tilt, hip tilt, lateral lean and the rest) in place of the tracker's guess. "Use tracker's points" starts a frame from the skeleton so you only drag to fix.
- Keyframes show as colored ticks on the timeline. Points are saved with your work and in session files.
- Measurements have color dots matching their point sets.
- Fix: the Follow box no longer drifts onto a neighbour. It only follows a body that is clearly inside it, moves at most 20% of its size per frame, and a body whose center is outside the box is ignored.

## 1.4.0
- Track a shot: new play button in Body tracking. Press play on the first frame of a throw, pause after the release, and only that stretch is tracked. It turns red while tracking.
- Step buttons either side of play move one frame and track it when it sits next to tracked frames, so you can add the frames you missed at the start or end without starting over. A direction toggle lets play track backward.
- Frame counter and tracked-range readout (Frame 22 / 120, Tracked 20-58). Tracked stretches are colored on the timeline bar and the video shows "tracked / not tracked".
- The Follow player box now only shows on tracked frames and follows the thrower from frame to frame.
- "Analyze body" is now "Analyze whole clip" and skips frames already tracked.
- Saved sessions and auto-saved work keep the tracked ranges and boxes.

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
