# ThrowLab Analyzer

A V1-Sports-style video analysis workstation for cornhole throws. Load a clip, pick the camera layout, step frame by frame, draw lines, angles and shapes on it, and let a body tracker add a skeleton and joint measurements.

Everything runs in the browser on your own device. Nothing is uploaded anywhere. There is no build step, so it works as a plain static site on GitHub Pages.

## What it does

- **Layout picker.** Open a clip, preview its first frame, and pick how the screen is laid out. The tool rail and measurements change with the layout.
- **Four layouts.**

  | Layout | Camera | Screen | Extra tools |
  |---|---|---|---|
  | Back of board | Behind the board, thrower at the far end | One large pane | Board outline with lane line, zoom window, vertical and level lines, Follow player |
  | Side view | Beside the thrower | Two clips side by side, with a comparison table | Path tracer, vertical and level lines |
  | Over the shoulder | About 2 ft behind and 6 ft to the side of the throwing shoulder | One large pane | Path tracer, zoom window, vertical and level lines, Follow player |
  | Broadcast / wide | TV or livestream footage | One large pane | Zoom window, Follow player |

- **Handedness.** Right or left, and for side and broadcast views, which side of the screen the target is on. Measurements follow the throwing arm.
- **Player.** Frame-by-frame stepping, play at 0.1x to 1x, scrub bar, loop. Frame rate is detected when a video loads and can be overridden.
- **Drawing tools.** Line (shows its angle), arrow, circle, square, three-point angle, pen, eraser, undo. Drawings can be pinned to one frame or shown on all frames.
- **Body tracking.** MediaPipe Pose Landmarker, 33 body points per frame. Pick the thrower with a Follow player box, which also zooms into that area so far-away throwers track better. Three model sizes and light or strong smoothing.
- **Measurements.** Elbow angle, arm swing, torso lean, lead knee, wrist height, shoulder and hip tilt, stance width, arm line. Which ones show depends on the layout.
- **Release marker.** Mark it by hand, or let the tracker suggest the frame where the throwing wrist moves fastest. Align releases to compare two throws.
- **Save session.** Download drawings, release marks and body tracking as a JSON file and load them again later. Save any frame with its drawings as a PNG.

## Run it

It needs to be served over http, not opened as a file, because it uses ES modules.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To publish: in the repo settings, turn on GitHub Pages and serve from the `main` branch root. The page then runs at `https://<user>.github.io/<repo>/`.

### On a phone

The same page works on a phone browser (the layout stacks to one column). Open the Pages link on the phone, tap Open clip, and pick a video from the camera roll. The tracker then runs on the phone itself. To move a clip from phone to desktop, use AirDrop, USB, or a shared drive folder, then open it with Open clip. A proper phone layout is still to do.

## Using it well

- Box the thrower with **Follow player** before analyzing whenever anyone else is in frame. Without it the tracker can lock onto a bystander.
- Shoot 60 fps or higher. Motion blur at 30 fps makes the wrist jumpy.
- Keep the whole body in frame, including feet.
- iPhone HEVC clips do not play in every browser. If a clip will not open, try Chrome or Safari, or export it as H.264 MP4.
- Analysis speed depends on the device. The tracker uses the GPU when it can and falls back to the CPU.

## Project layout

```
index.html          page shell
css/app.css         styles (dark and light themes follow the system)
js/config.js        layouts, tool definitions  <- add a new camera layout here
js/main.js          app state, picker, panels, transport, sessions
js/pane.js          one clip pane: media, stepping, drawing, body overlay
js/annotate.js      drawing shapes and eraser hit testing
js/pose.js          MediaPipe loading, analysis, person picking, smoothing
js/metrics.js       joint-angle measurements and release suggestion
vendor/mediapipe/   MediaPipe Tasks Vision runtime (Apache-2.0)
models/             MediaPipe Pose Landmarker models (Apache-2.0): lite, full, heavy
tests/              browser smoke test
```

### Adding a layout

Add an entry to `LAYOUTS` in `js/config.js` with its name, tips, whether it starts split, its extra tools, and its measurements. Add a small diagram to `DIAGRAMS` in `js/main.js` for the picker card.

## Tests

```bash
pip install playwright && playwright install chromium
python3 tests/smoke_test.py
```

The test generates its own video with ffmpeg, so it needs ffmpeg on the path. It checks the picker, every layout's tools, drawing, stepping, comparison and session saving. It does not run the body tracker.

## Footage and privacy

Do not commit throw footage or photos of people to this repo. Video files are ignored by `.gitignore`. Broadcast and event footage is for private study only. If you later collect training or coaching footage, get consent from the people in it first.

## Credits

Body tracking uses Google MediaPipe, licensed under Apache-2.0. See `NOTICE.md`.

## Versions

The version shows beside the ThrowLab name. It is MAJOR.MINOR.PATCH: a new feature raises the middle number (1.2.1 to 1.3.0), a fix raises the last (1.2.1 to 1.2.2), and a big rework raises the first. History is in CHANGELOG.md. Change `VERSION` in `js/config.js` when you push.
