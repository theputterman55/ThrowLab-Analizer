// Layout and tool configuration. Adding a new camera layout means adding one entry to LAYOUTS.

// App version, MAJOR.MINOR.PATCH (see CHANGELOG.md). Set it in index.html (window.__TL_VERSION) with every push.
export const VERSION = globalThis.__TL_VERSION || 'dev'; // set in index.html

export const CORE_TOOLS = ['cursor', 'line', 'arrow', 'circle', 'rect', 'angle', 'pen', 'eraser'];

export const TOOL_DEFS = {
  cursor: { label: 'Cursor', key: 'V', hint: 'Click a pane to select it. No drawing.', svg: '<path d="M6 3l13 8-6 2-3 6z"/>' },
  line:   { label: 'Line', key: 'L', hint: 'Drag to draw a line. The label shows its angle from horizontal.', svg: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>' },
  arrow:  { label: 'Arrow', key: 'A', hint: 'Drag to draw an arrow.', svg: '<path d="M5 19L19 5M10 5h9v9"/>' },
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
      'Draw the board outline to get a lane line, then box the thrower with Follow player.',
      'Shoot 60 fps or higher. 4K helps when the thrower is far away.'
    ],
    split: false, pin: 'all', dirChoice: false,
    extraTools: ['plumb', 'level', 'board', 'lens', 'roi'],
    metrics: [
      { k: 'shoulderTilt' }, { k: 'hipTilt' }, { k: 'lean', label: 'Lateral lean' }, { k: 'stance' }, { k: 'elbow' }
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
      { k: 'elbow' }, { k: 'arm' }, { k: 'lean' }, { k: 'knee' }, { k: 'wristH' }
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
      { k: 'elbow' }, { k: 'shoulderTilt' }, { k: 'hipTilt' }, { k: 'lean', label: 'Lateral lean' }, { k: 'armLine' }
    ]
  },
  broadcast: {
    id: 'broadcast',
    name: 'Broadcast / wide',
    blurb: 'TV or livestream footage. Moving camera, graphics, other people on screen.',
    tips: [
      'The camera moves and cuts, so drawings pin to a single frame by default.',
      'Always box the player with Follow player. Screens and graphics can contain other people.',
      'Keep broadcast footage for private study only.'
    ],
    split: false, pin: 'frame', dirChoice: true,
    extraTools: ['lens', 'roi'],
    metrics: [
      { k: 'elbow' }, { k: 'arm' }, { k: 'lean' }, { k: 'shoulderTilt' }, { k: 'knee' }
    ]
  }
};

export const LAYOUT_ORDER = ['back', 'side', 'shoulder', 'broadcast'];

export const toolsFor = (layoutId) => [...CORE_TOOLS, ...LAYOUTS[layoutId].extraTools];

export const FPS_CHOICES = [24, 25, 30, 48, 50, 60, 90, 100, 120, 240];
export const COL = { A: '#5be3b5', B: '#7db8ff' };
export const SWATCHES = [['#f2b63d', 'Amber'], ['#ff6a5c', 'Red'], ['#5be3b5', 'Mint'], ['#ffffff', 'White'], ['#c48bff', 'Violet']];
