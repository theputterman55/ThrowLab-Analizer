# Changelog

Versions use MAJOR.MINOR.PATCH (semantic versioning).

- **MAJOR** changes when something big is reworked or old saved sessions may stop working.
- **MINOR** changes when a new feature or tool is added.
- **PATCH** changes for fixes and small tweaks that add nothing new.

The current version is shown next to the ThrowLab name (top left) and is set in `index.html` (`window.__TL_VERSION`). Changing it also forces browsers to load the new code.

## 1.9.1
- Angle boxes sit halfway between the edge of the picture and the player, never touching the marked points.
- The Elbow leader line ends on the middle of the upper-arm line and the Wrist leader on the middle of the forearm line (the shoulder tilt one was already on the middle of the shoulder line).

## 1.9.0
- Angle readouts are about 50% bigger, carry a name (Shoulder tilt, Elbow, Wrist, Hip tilt) and are stacked over each other in the margin of the video, on the side the player is standing (left player reads on the left, right player on the right). A colored leader line ties each box to its joint.

## 1.8.5
- Arm and Shoulders stay connected on every frame, including frames past where the Shoulders set was finished (the arm hangs from the nearest shoulder keyframe).
- In Arm mode you can now drag the arm's shoulder end. It moves the Shoulders throwing-shoulder dot on that frame, so the two always move together. Past the end of the Shoulders set this adds a shoulder keyframe and stretches the set to that frame.

## 1.8.4
- Arm: new "Lock arm (move together)" checkbox in the Arm panel, off by default. Off: elbow, wrist and hand drag independently. On: dragging the elbow carries the wrist and hand, dragging the wrist carries the hand.
- The shoulder end always stays attached to the Shoulders dot; moving the shoulder swings the arm from that point and the elbow stays where it was.
- A dot sitting under the center move dot can now be grabbed (the elbow or wrist wins over the center dot within about 11 px).

## 1.8.3
- Arm set hangs from the Shoulders dot: its first click is the elbow, then the wrist, then the hand. This also works on frames outside the Shoulders range (it uses the nearest shoulder keyframe).
- Hand is optional: press Finish after the wrist to leave it out. The wrist angle then stays blank.

## 1.8.2
- Right panel about 25% larger: wider column, bigger text and buttons.
- Point labeler is now at the top of the panel, with stacked, boxed groups: Point sets (sets stacked, then Undo / Finish / Rotate (S) / Clear set in a 2x2 grid), Step through the clip, Player, Throw.
- Dimmed text and greyed-out buttons are about 75% less dim.

## 1.8.1
- Compact Point labeler: the instruction text is hidden. A small **?** button by the heading shows it again (and remembers your choice). The prompt that tells you which point to click next stays visible.
- Undo, Finish, Clear set and Rotate now sit in one row right under the Shoulders / Hips / Arm buttons, always on screen. Finish, Clear set and Rotate are greyed out when no set is active.
- Player 1/2 buttons read P1 / P2 and share a line with Show box, Draw and the clear button. The heading reads "P1 · T1". The frame and motion summary are two short lines.
- The pointer is the arrow everywhere, including the Cursor tool when zoomed in. The hand shows only while you are actually panning. Over the center dot the pointer is the move cursor, and over the rotate pin it is a crosshair.

## 1.8.0
- Move a whole line: while a point set is active, a small hollow dot sits at the center of its line. Drag it to slide the whole line. Dragging an endpoint still moves just that point.
- Rotate: the **Rotate (S)** button, or the **S** key while a point set is active, shows a pin that drops from the center dot. Drag the pin's round handle to turn the line about its center, with the angle shown while you drag. Press S again to hide it. With no set active, S is still the Square tool.
- **From this frame** (default) changes this frame and the frames after it. **Whole set** shifts or turns every keyframe of the set by the same amount, to fix a line that was placed slightly off for the whole throw.
- Arm: the center dot slides the elbow, wrist and hand together (the shoulder stays on your Shoulders points) and the pin turns the arm about the shoulder.
- Moves and turns can be undone with Undo / Ctrl+Z.

## 1.7.0
- Player boxes, driven by frame. Next to Player 1 / 2 there is a **Show box** button, **Draw** and **×**. Draw (or the new Player box tool, F, on the left) drags a box around the selected player and turns it on from the current frame.
- Show box turns that player's box on or off from the frame you press it on. When one player's box turns on, the other player's box turns off at that frame, so the boxes hand off as the clip plays. Switch them on and off as often as you like.
- Player 1 is red and Player 2 is blue (the Player buttons, the boxes and the timeline bands). Colored bands on the timeline show where each box is on.
- Boxes are saved with your work and session files. Clear boxes removes both players' boxes and the Zoom box.
- The old Follow player tool moved to Q (it only appears with ?tracker=1).

## 1.6.0
- Arm set in the Point labeler: click the throwing shoulder, elbow, wrist and hand. Three color-coded segments (upper arm, forearm, hand) with the elbow and wrist angles on the video. If you already placed Shoulders on that frame, the arm starts from that shoulder and you only click the elbow, wrist and hand. Move the Shoulders and the arm follows.
- New measurements: Forearm swing and Wrist angle (next to Elbow angle). Elbow angle now works from your arm points.
- Step bar for the labeler (above Undo): start of the motion, previous keyframe, back one frame, play/pause, forward one frame, next keyframe, end of the motion, with a frame readout.
- Undo button for point changes, under the step bar (Ctrl+Z still works).
- Motion summary: where the labeled motion starts and ends, how many frames, how long it lasts, and whether every set is finished.
- Player 1 / 2 and Throw 1-4 (plus a + button) for each clip. Each player and throw keeps its own points and its own description. The Point labeler and Measurements headings show the player and throw. Older saves open as Player 1, Throw 1.
- Fix: the keyframe ticks on the timeline were hidden in 1.5.1. They are back.
- The comparison table works from placed points, not only from the tracker.

## 1.5.2
- D (next frame) and A (previous frame) always step frames now, with or without a point set active. Shift+D / Shift+A step 5 frames. The point labeler follows each step.
- The Arrow tool shortcut moves from A to R.
- A slider you just used no longer swallows D, A and the arrow keys.

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
