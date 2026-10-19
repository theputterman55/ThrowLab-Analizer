// Layout and tool configuration. Adding a new camera layout means adding one entry to LAYOUTS.

// App version, MAJOR.MINOR.PATCH (see CHANGELOG.md). Set it in index.html (window.__TL_VERSION) with every push.
export const VERSION = globalThis.__TL_VERSION || 'dev'; // set in index.html

export const CORE_TOOLS = ['cursor', 'line', 'arrow', 'circle', 'rect', 'angle', 'pen', 'eraser'];

export const TOOL_DEFS = {
  cursor: { label: 'Cursor', key: 'V', hint: 'Click a pane to select it. No drawing.', svg: '<path d="M6 3l13 8-6 2-3 6z"/>' },
  line:   { label: 'Line', key: 'L', hint: 'Drag to draw a line. The label shows its angle from horizontal.', svg: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>' },
  arrow:  { label: 'Arrow', key: 'R', hint: 'Drag to draw an arrow.', svg: '<path d="M5 19L19 5M10 5h9v9"/>' },
  circle: { label: 'Circle', key: 'C', hint: 'Drag from the center outward.', svg: '<circle cx="12" cy="12" r="8"/>' },
  rect:   { label: 'Square', key: 'S', hint: 'Drag corner to corner.', svg: '<rect x="5" y="5" width="14" height="14"/>' },
  angle:  { label: 'Angle', key: 'G', hint: 'Click three points: start, corner, end.', svg: '<path d="M4 19h16M4 19L16 7"/><path d="M12 19a8 8 0 0 0 -2.3 -5.7"/>' },
  pen:    { label: 'Pen', key: 'P', hint: 'Draw freehand.', svg: '<path d="M4 20c3-8 6 2 9-6s5-4 7-8"/>' },
  eraser: { label: 'Eraser', key: 'E', hint: 'Click a drawing to remove it.', svg: '<path d="M8 20h11M5 15l8-9 6 5-6 7H8z"/>' },
  plumb:  { label: 'Vertical line', key: 'U', hint: 'Click to drop a vertical line.', svg: '<path d="M12 3v18"/><path d="M8 8l4-5 4 5"/>' },
  level:  { label: 'Level line', key: 'H', hint: 'Click to drop a horizontal line.', svg: '<path d="M3 12h18"/><path d="M16 8l5 4-5 4"/>' },
  path:   { label: 'Path tracer', key: 'T', hint: 'Click the bag or hand on each frame. The dots join into a path. Press Enter to finish.', svg: '<circle cx="5" cy="18" r="1.6"/><circle cx="10" cy="9" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="20" cy="12" r="1.6"/><path d="M5 18L10 9L16 6L20 12" stroke-dasharray="2 2"/>' },
  board:  { label: 'Board outline', key: 'B', hint: 'Click the 4 board corners: near left, near right, far right, far left.', svg: '<path d="M7 5h10l3 14H4z"/><path d="M12 5v14" stroke-dasharray="2 2"/>' },
  lens:   { label: 'Zoom window', key: 'Z', hint: 'Drag a box over the thrower to magnify them in a corner window. To zoom the whole picture, pinch or scroll over it.', svg: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M10 7v6M7 10h6"/>' },
  roi:    { label: 'Follow player', key: 'F', hint: 'Drag a box around the thrower so the body tracker follows only them.', svg: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><circle cx="12" cy="9" r="2"/><path d="M12 11v5M9 13h6"/>' }
};

export const LAYOUTS = {
  back: {
    id: 'back',
    name: 'Back of board',
    blurb: 'Camera behind the board, thrower at the far end. One large pane with a zoom window.',
    tips: [
      'Phone on a tripod behind the board, level, with the whole board and the thrower in frame.',
      'Draw the board outline to get a lane line, then mark the joints with the Point labeler.',
      'Shoot 60 fps or higher. 4K helps when the thrower is far away.'
    ],
    split: false, pin: 'all', dirChoice: false,
    extraTools: ['plumb', 'level', 'board', 'lens', 'roi'],
    metrics: [
      { k: 'shoulderTilt' }, { k: 'hipTilt' }, { k: 'lean', label: 'Lateral lean' }, { k: 'stance' }, { k: 'elbow' }, { k: 'forearm' }, { k: 'wristBend' }
    ]
  },
  side: {
    id: 'side',
    name: 'Side view',
    blurb: 'Camera to the side of the thrower. Two throws side by side for comparison.',
    tips: [
      'Tripod level with the thrower, square to the lane, whole body and feet in frame.',
      'Set which side of the screen the target is on so swing and lean read forward.',
      'Mark the release on each clip, then use Align releases to compare.'
    ],
    split: true, pin: 'all', dirChoice: true,
    extraTools: ['plumb', 'level', 'path'],
    metrics: [
      { k: 'elbow' }, { k: 'forearm' }, { k: 'wristBend' }, { k: 'arm' }, { k: 'lean' }, { k: 'knee' }, { k: 'wristH' }
    ]
  },
  shoulder: {
    id: 'shoulder',
    name: 'Over the shoulder',
    blurb: 'Camera about 2 ft behind and 6 ft to the side of the throwing shoulder, looking toward the target.',
    tips: [
      'Right-handers: camera behind and to the right. Left-handers: mirror it to the left.',
      'Good for arm path, shoulder line, and how the throw lines up with the target.',
      'Use the path tracer to follow the bag or hand frame by frame.'
    ],
    split: false, pin: 'all', dirChoice: false,
    extraTools: ['plumb', 'level', 'path', 'lens', 'roi'],
    metrics: [
      { k: 'elbow' }, { k: 'forearm' }, { k: 'wristBend' }, { k: 'shoulderTilt' }, { k: 'hipTilt' }, { k: 'lean', label: 'Lateral lean' }, { k: 'armLine' }
    ]
  },
  broadcast: {
    id: 'broadcast',
    name: 'Broadcast / wide',
    blurb: 'TV or livestream footage. Moving camera, graphics, other people on screen.',
    tips: [
      'The camera moves and cuts, so drawings pin to a single frame by default.',
      'Mark the joints by hand with the Point labeler. Screens and graphics can contain other people.',
      'Keep broadcast footage for private study only.'
    ],
    split: false, pin: 'frame', dirChoice: true,
    extraTools: ['lens', 'roi'],
    metrics: [
      { k: 'elbow' }, { k: 'forearm' }, { k: 'wristBend' }, { k: 'arm' }, { k: 'lean' }, { k: 'shoulderTilt' }, { k: 'knee' }
    ]
  }
};

export const LAYOUT_ORDER = ['back', 'side', 'shoulder', 'broadcast'];

// The automatic body tracker is switched off (v1.5.1). Open the page with ?tracker=1 to bring it back (for testing).
export const TRACKER_UI = /[?&]tracker=1/.test(globalThis.location?.search || '');

export const toolsFor = (layoutId) => [...CORE_TOOLS, ...LAYOUTS[layoutId].extraTools].filter((t) => TRACKER_UI || t !== 'roi');

export const FPS_CHOICES = [24, 25, 30, 48, 50, 60, 90, 100, 120, 240];
export const COL = { A: '#5be3b5', B: '#7db8ff' };
export const SWATCHES = [['#f2b63d', 'Amber'], ['#ff6a5c', 'Red'], ['#5be3b5', 'Mint'], ['#ffffff', 'White'], ['#c48bff', 'Violet']];

// Joint sets you can place by hand (Point labeler). roles are mapped to the thrower's side with the Right/Left hand setting.
export const POINT_SETS = {
  shoulders: { label: 'Shoulders', color: '#ff8a3d', metric: 'shoulderTilt', roles: ['sh', 'oSh'], names: ['throwing shoulder', 'other shoulder'] },
  hips: { label: 'Hips', color: '#4da3ff', metric: 'hipTilt', roles: ['hip', 'oHip'], names: ['throwing hip', 'other hip'] }
};
POINT_SETS.arm = {
  label: 'Arm', color: '#ff6b81', metric: 'elbow', chain: true, roles: ['sh', 'el', 'wr', 'hand'],
  names: ['throwing shoulder', 'elbow', 'wrist', 'hand'], segColors: ['#ff6b81', '#f06bd6', '#b58bff'],
  note: 'The shoulder is shared with your Shoulders points when they exist on the same frame.'
};
export const POINT_SET_ORDER = ['shoulders', 'hips', 'arm'];
// Color code shown beside each measurement (the point sets above use the same colors).
export const METRIC_COLORS = { shoulderTilt: '#ff8a3d', hipTilt: '#4da3ff', lean: '#e6e65a', stance: '#c79bff', elbow: '#ff6b81', arm: '#ff9db0', forearm: '#f06bd6', wristBend: '#b58bff' };
