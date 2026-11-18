/**
 * The stitched bot avatar, drawn as plain SVG node descriptions so web and
 * mobile paint the same critter with their own SVG elements. A body is the
 * picker's flat shape with a furry edge, floppy ears, two feet, a sewn-on
 * patch and a face whose mood says what the bot is doing:
 *
 * - `happy`: working or resting, a big grin with one tiny tooth.
 * - `confused`: needs a decision from you, one brow up and a question mark.
 * - `sad`: blocked, worried brows, a tear and drooping ears.
 *
 * Everything sits on a 100×100 viewBox and may spill a little past it (ears,
 * fur), so callers draw with overflow visible.
 */

export type BotArtShape =
  | "circle"
  | "squircle"
  | "square"
  | "pill"
  | "triangle"
  | "hex"
  | "cloud"
  | "drop";

export type BotMood = "happy" | "confused" | "sad";

/** One SVG element: a tag and its camelCase attributes, valid for React DOM and react-native-svg. */
export type BotArtNode = {
  readonly tag: "path" | "ellipse" | "circle" | "rect";
  readonly attrs: Readonly<Record<string, string | number>>;
};

export type BotArt = {
  /** Ears and feet, drawn behind the body. */
  readonly back: ReadonlyArray<BotArtNode>;
  /** The furry body outline: fill it with the color, then with `BOT_ART_LIGHT`. */
  readonly body: string;
  /** Stroke for light bodies that would fade into a light surface, or null. */
  readonly outline: string | null;
  /** The sewn-on patch, clipped to `body`. */
  readonly patch: ReadonlyArray<BotArtNode>;
  /** Each eye in its own space, centered on the eye and drawn at face scale 1. */
  readonly eyes: readonly [ReadonlyArray<BotArtNode>, ReadonlyArray<BotArtNode>];
  /** Brows, cheeks, mouth and props in viewBox space. */
  readonly face: ReadonlyArray<BotArtNode>;
};

/** Where the face sits. It looks up and to the right; bottom-heavy shapes carry it lower. */
export const BOT_FACE_LAYOUT: Record<BotArtShape, { x: number; y: number; scale: number }> = {
  circle: { x: 66, y: 40, scale: 1.1 },
  squircle: { x: 64, y: 42, scale: 1.1 },
  square: { x: 66, y: 40, scale: 1.1 },
  pill: { x: 64, y: 46, scale: 1 },
  triangle: { x: 50, y: 64, scale: 0.85 },
  hex: { x: 64, y: 42, scale: 1.1 },
  cloud: { x: 62, y: 50, scale: 1 },
  drop: { x: 57, y: 62, scale: 1 },
};

/** Eye centers relative to the face origin, before face scale. */
export const BOT_EYE_OFFSETS = [
  { x: -14.5, y: 0 },
  { x: 14.5, y: 0 },
] as const;

/** Flat body geometry from the avatar picker, on a 100×100 viewBox. */
export const BOT_BODY: Record<BotArtShape, string> = {
  circle: "M4 50A46 46 0 1 1 96 50A46 46 0 1 1 4 50Z",
  squircle:
    "M96.8 50C97.5 55.5 97.4 62 95.3 67.3C93.3 72.6 89.2 78.2 84.6 81.9C80 85.5 73.4 87.9 67.6 89.1C61.8 90.4 55.6 89.9 50 89.4C44.4 88.9 39.1 87.7 33.8 86C28.5 84.3 23 82.4 18.3 79.2C13.7 76 8.7 71.7 5.9 66.8C3.1 62 1.3 55.6 1.4 50C1.5 44.4 3.6 38.3 6.3 33.3C9 28.3 13.3 23.8 17.7 20.2C22 16.5 27.3 13.4 32.7 11.4C38.1 9.4 44.2 8.1 50 8.1C55.8 8.2 62 9.5 67.2 11.7C72.4 13.9 77.2 17.5 81.2 21.2C85.2 25 88.6 29.5 91.2 34.3C93.8 39.1 96.1 44.5 96.8 50Z",
  square: "M30 6H70C88 6 94 12 94 30V70C94 88 88 94 70 94H30C12 94 6 88 6 70V30C6 12 12 6 30 6Z",
  pill: "M34 19H66A31 31 0 0 1 66 81H34A31 31 0 0 1 34 19Z",
  triangle: "M35.6 28.3Q50 2 64.4 28.3L89.9 75.1Q98 90 81 90L19 90Q2 90 10.1 75.1Z",
  hex: "M42.2 5.5Q50 1 57.8 5.5L84.6 21Q92.4 25.5 92.4 34.5L92.4 65.5Q92.4 74.5 84.6 79L57.8 94.5Q50 99 42.2 94.5L15.4 79Q7.6 74.5 7.6 65.5L7.6 34.5Q7.6 25.5 15.4 21Z",
  cloud:
    "M31 80.7A20 20 0 1 1 16.7 43.4A22 22 0 0 1 53.4 22.3A19 19 0 0 1 82.3 43A20 20 0 0 1 69 80.7A24 24 0 0 1 31 80.7Z",
  drop: "M42.6 12.4Q50 3 57.4 12.4L78.2 38.7A36 36 0 1 1 21.8 38.7Z",
};

/** Soft top-left light over the body: a radial gradient in objectBoundingBox units. */
export const BOT_ART_LIGHT = {
  cx: "34%",
  cy: "28%",
  r: "80%",
  stops: [
    { offset: 0, color: "#FFFFFF", opacity: 0.42 },
    { offset: 0.45, color: "#FFFFFF", opacity: 0 },
    { offset: 1, color: "#000000", opacity: 0.22 },
  ],
} as const;

/** Top of each outline, where the ears attach. */
const EAR_TOP: Record<BotArtShape, number> = {
  circle: 5,
  squircle: 9,
  square: 7,
  pill: 20,
  triangle: 9,
  hex: 3,
  cloud: 21,
  drop: 6,
};

/** Bottom of each outline, where the feet stand. */
const FEET_Y: Record<BotArtShape, number> = {
  circle: 94,
  squircle: 89,
  square: 93,
  pill: 80,
  triangle: 89,
  hex: 94,
  cloud: 86,
  drop: 96,
};

/** Ear swing per mood: left and right, in degrees around each ear's base. */
const EAR_TILT: Record<BotMood, readonly [number, number]> = {
  happy: [0, 0],
  confused: [0, 40],
  sad: [-48, 48],
};

const DARK_INK = "#161616";

const LIGHT_INK = "#FFFFFF";

const BLUSH = "#FF6F91";

const TONGUE = "#FF8AA0";

const EAR_INNER = "#FF8FAB";

const TEAR = "#7FD3FF";

// ---------------------------------------------------------------------------
// Fur: the outline is flattened, resampled at even steps and pushed in and out
// along its normal by a deterministic wobble, so it reads furry without an SVG
// filter (react-native-svg has none for this, and filters cost every repaint).

type Point = { x: number; y: number };

function arcPoints(from: Point, args: number[], out: Point[]) {
  const [rxIn = 0, ryIn = 0, rotation = 0, large = 0, sweep = 0, x = 0, y = 0] = args;
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - x) / 2;
  const dy = (from.y - y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);

  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }

  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);

  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);

  if (!sweep && delta > 0) delta -= 2 * Math.PI;

  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / 0.5));

  for (let index = 1; index <= steps; index += 1) {
    const t = start + (delta * index) / steps;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
}

/** Flattens an absolute M/L/H/V/Q/C/A/Z path into one closed polyline. */
function flatten(d: string): Point[] {
  const tokens = d.match(/[MLHVQCAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  let command = "M";
  let index = 0;

  const next = (count: number) => {
    const values = tokens.slice(index, index + count).map(Number);
    index += count;

    return values;
  };

  const curve = (points: Point[]) => {
    const steps = 24;

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const u = 1 - t;
      const [p0, p1, p2, p3] = points;

      if (!p0 || !p1 || !p2) return;
      out.push(
        p3
          ? {
              x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
              y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
            }
          : {
              x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
              y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
            },
      );
    }
  };

  while (index < tokens.length) {
    const token = tokens[index] ?? "";

    if (/[a-z]/i.test(token)) {
      command = token.toUpperCase();
      index += 1;

      if (command === "Z") continue;
    }

    if (command === "M" || command === "L") {
      const [x = 0, y = 0] = next(2);
      at = { x, y };
      out.push(at);
      command = "L";
    } else if (command === "H") {
      at = { x: next(1)[0] ?? at.x, y: at.y };
      out.push(at);
    } else if (command === "V") {
      at = { x: at.x, y: next(1)[0] ?? at.y };
      out.push(at);
    } else if (command === "Q") {
      const [qx = 0, qy = 0, x = 0, y = 0] = next(4);
      curve([at, { x: qx, y: qy }, { x, y }]);
      at = { x, y };
    } else if (command === "C") {
      const [ax = 0, ay = 0, bx = 0, by = 0, x = 0, y = 0] = next(6);
      curve([at, { x: ax, y: ay }, { x: bx, y: by }, { x, y }]);
      at = { x, y };
    } else if (command === "A") {
      const args = next(7);
      arcPoints(at, args, out);
      at = { x: args[5] ?? at.x, y: args[6] ?? at.y };
    } else {
      index += 1;
    }
  }

  return out;
}

/** Small deterministic random in [-1, 1). */
function wobble(seed: number) {
  let state = seed * 2654435761;

  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;

    return (state / 4294967296) * 2 - 1;
  };
}

/** Gives a closed outline a furry edge: tufts every ~3 units, about ±2 units deep. */
export function furryPath(d: string, seed: number, depth = 2): string {
  const points = flatten(d);
  const lengths = [0];

  for (let index = 1; index <= points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index % points.length];

    if (!a || !b) break;
    lengths.push((lengths[index - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }

  const total = lengths[lengths.length - 1] ?? 0;
  const count = Math.max(24, Math.round(total / 1.3));
  const random = wobble(seed + 1);

  const pointAt = (distance: number): Point => {
    const target = ((distance % total) + total) % total;
    let index = lengths.findIndex((length) => length > target);

    if (index < 1) index = 1;
    const a = points[index - 1] ?? { x: 0, y: 0 };
    const b = points[index % points.length] ?? a;
    const span = (lengths[index] ?? 0) - (lengths[index - 1] ?? 0) || 1;
    const t = (target - (lengths[index - 1] ?? 0)) / span;

    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  const step = total / count;
  const parts: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const here = pointAt(index * step);
    const before = pointAt(index * step - step);
    const after = pointAt(index * step + step);
    const tx = after.x - before.x;
    const ty = after.y - before.y;
    const length = Math.hypot(tx, ty) || 1;
    // Alternate tuft tips and roots, each jittered, so the edge looks combed rather than toothed.
    const offset = depth * ((index % 2 === 0 ? 0.55 : -0.45) + 0.55 * random());
    const x = here.x + (ty / length) * offset;
    const y = here.y - (tx / length) * offset;
    parts.push(`${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  return `${parts.join("")}Z`;
}

const furCache = new Map<string, string>();

function cachedFur(key: string, d: string, seed: number, depth?: number) {
  let fur = furCache.get(key);

  if (fur === undefined) {
    fur = furryPath(d, seed, depth);
    furCache.set(key, fur);
  }

  return fur;
}

// ---------------------------------------------------------------------------

const node = (tag: BotArtNode["tag"], attrs: BotArtNode["attrs"]): BotArtNode => ({ tag, attrs });

function relativeLuminance(color: string): number | null {
  if (!/^#[\da-f]{6}$/i.test(color)) return null;

  const [red = 0, green = 0, blue = 0] = [1, 3, 5]
    .map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Ink for eyes and lines: dark on every body except a near-black one. */
export function botArtInk(color: string): string {
  const luminance = relativeLuminance(color);

  return luminance !== null && luminance < 0.02 ? LIGHT_INK : DARK_INK;
}

/** The floppy ear in its own space: base at the origin, pointing right. */
const EAR_OUTER = "M0 0Q8 -26 34 -22Q22 2 -2 12Z";

const EAR_INNER_PATH = "M3 2Q10 -18 26 -17Q18 1 2 8Z";

const FOOT = "M28 0A8 4.6 0 1 1 44 0A8 4.6 0 1 1 28 0Z";

function ears(shape: BotArtShape, color: string, ink: string, mood: BotMood): BotArtNode[] {
  const top = EAR_TOP[shape];

  const bases = [
    { x: 30, y: top + 16, dir: -1 },
    { x: 70, y: top + 14, dir: 1 },
  ] as const;

  const outer = cachedFur("ear", EAR_OUTER, 11, 1.4);

  return bases.flatMap((base, index) => {
    const transform = `translate(${base.x} ${base.y}) rotate(${EAR_TILT[mood][index]}) scale(${base.dir} 1)`;

    return [
      node("path", { d: outer, fill: color, transform }),
      node("path", { d: EAR_INNER_PATH, fill: EAR_INNER, opacity: 0.75, transform }),
      node("path", {
        d: "M16 -15l4 6",
        stroke: ink,
        strokeWidth: 2,
        strokeLinecap: "round",
        opacity: 0.55,
        transform,
      }),
    ];
  });
}

function eye(ink: string, sparkle: string, kind: "round" | "teary" | "squint"): BotArtNode[] {
  if (kind === "teary") {
    return [
      node("ellipse", { cx: 0, cy: 1.5, rx: 9.8, ry: 10.6, fill: ink }),
      node("circle", { cx: 3, cy: -2.6, r: 3.6, fill: sparkle }),
      node("circle", { cx: -2.6, cy: 5.6, r: 2.6, fill: sparkle }),
    ];
  }

  if (kind === "squint") {
    return [
      node("ellipse", { cx: 0, cy: 1, rx: 7.6, ry: 8.8, fill: ink }),
      node("circle", { cx: 2.4, cy: -2.2, r: 3, fill: sparkle }),
    ];
  }

  return [
    node("ellipse", { cx: 0, cy: 0, rx: 9.8, ry: 11.4, fill: ink }),
    node("circle", { cx: 3.2, cy: -4.2, r: 3.8, fill: sparkle }),
    node("circle", { cx: -3.4, cy: 4.4, r: 1.8, fill: sparkle }),
  ];
}

function face(shape: BotArtShape, ink: string, mood: BotMood): BotArtNode[] {
  const { x, y, scale: k } = BOT_FACE_LAYOUT[shape];
  const left = x + BOT_EYE_OFFSETS[0].x * k;
  const right = x + BOT_EYE_OFFSETS[1].x * k;
  const mouthY = y + 12 * k;

  const line = (d: string): BotArtNode =>
    node("path", {
      d,
      stroke: ink,
      strokeWidth: 2.2 * k,
      fill: "none",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    });

  const cheeks = [left - 4.5 * k, right + 4.5 * k].map((cx) =>
    node("ellipse", {
      cx,
      cy: y + 13 * k,
      rx: 5.4 * k,
      ry: 3.2 * k,
      fill: BLUSH,
      opacity: mood === "sad" ? 0.3 : 0.6,
    }),
  );

  if (mood === "sad") {
    return [
      ...cheeks,
      line(`M${left - 8 * k} ${y - 13 * k}L${left + 5 * k} ${y - 17.5 * k}`),
      line(`M${right + 8 * k} ${y - 13 * k}L${right - 5 * k} ${y - 17.5 * k}`),
      node("path", {
        d: `M${left - 7 * k} ${y + 9 * k}q${-3 * k} ${5 * k} 0 ${7 * k}q${3 * k} ${-2 * k} 0 ${-7 * k}z`,
        fill: TEAR,
        stroke: "#FFFFFF",
        strokeWidth: 0.8 * k,
      }),
      line(`M${x - 5 * k} ${mouthY + 3.5 * k}q${5 * k} ${-5 * k} ${10 * k} 0`),
    ];
  }

  if (mood === "confused") {
    const qx = x + 24 * k;
    const qy = y - 14 * k;
    const question = `M${qx - 4 * k} ${qy - 9.5 * k}C${qx - 4 * k} ${qy - 14.5 * k} ${qx + 5 * k} ${qy - 15 * k} ${qx + 5 * k} ${qy - 10 * k}C${qx + 5 * k} ${qy - 7 * k} ${qx + k} ${qy - 7 * k} ${qx + k} ${qy - 4.5 * k}`;

    return [
      ...cheeks,
      line(`M${left - 7 * k} ${y - 15 * k}L${left + 6 * k} ${y - 14 * k}`),
      line(`M${right - 7 * k} ${y - 15 * k}q${7 * k} ${-8 * k} ${13 * k} ${-2 * k}`),
      line(
        `M${x - 6 * k} ${mouthY + k}q${1.5 * k} ${-2.5 * k} ${3 * k} 0q${1.5 * k} ${2.5 * k} ${3 * k} 0q${1.5 * k} ${-2.5 * k} ${3 * k} 0q${1.5 * k} ${2.5 * k} ${3 * k} 0`,
      ),
      node("path", {
        d: question,
        stroke: ink,
        strokeWidth: 5.6 * k,
        fill: "none",
        strokeLinecap: "round",
      }),
      node("path", {
        d: question,
        stroke: "#FFFFFF",
        strokeWidth: 2.6 * k,
        fill: "none",
        strokeLinecap: "round",
      }),
      node("circle", { cx: qx + k, cy: qy - 0.8 * k, r: 2.8 * k, fill: ink }),
      node("circle", { cx: qx + k, cy: qy - 0.8 * k, r: 1.5 * k, fill: "#FFFFFF" }),
    ];
  }

  return [
    ...cheeks,
    node("ellipse", { cx: x, cy: mouthY - 6 * k, rx: 3 * k, ry: 2 * k, fill: ink }),
    node("path", {
      d: `M${x - 8 * k} ${mouthY - 2 * k}q${8 * k} ${11 * k} ${16 * k} 0z`,
      fill: ink,
      stroke: ink,
      strokeWidth: 1.6 * k,
      strokeLinejoin: "round",
    }),
    node("path", {
      d: `M${x - 4.2 * k} ${mouthY + 3.6 * k}q${4.2 * k} ${3.4 * k} ${8.4 * k} 0q${-4.2 * k} ${-2.4 * k} ${-8.4 * k} 0z`,
      fill: TONGUE,
    }),
    node("rect", {
      x: x + k,
      y: mouthY - 1.6 * k,
      width: 3 * k,
      height: 2.8 * k,
      rx: k,
      fill: "#FFFFFF",
    }),
  ];
}

const PATCH: ReadonlyArray<BotArtNode> = [
  node("rect", {
    x: 14,
    y: 58,
    width: 22,
    height: 20,
    rx: 3,
    fill: "#FFFFFF",
    opacity: 0.2,
    transform: "rotate(-10 26 70)",
  }),
  node("rect", {
    x: 14,
    y: 58,
    width: 22,
    height: 20,
    rx: 3,
    fill: "none",
    stroke: "#FFFFFF",
    strokeWidth: 1.8,
    strokeDasharray: "3 3",
    opacity: 0.9,
    transform: "rotate(-10 26 70)",
  }),
];

/** Everything needed to paint one stitched bot. Pure and cheap after the first call per shape. */
export function botAvatarArt(shape: BotArtShape, color: string, mood: BotMood): BotArt {
  const ink = botArtInk(color);
  const sparkle = ink === LIGHT_INK ? DARK_INK : "#FFFFFF";
  const shapeSeed = Object.keys(BOT_BODY).indexOf(shape);
  const foot = cachedFur("foot", FOOT, 7, 1.2);
  const feetY = FEET_Y[shape];
  const luminance = relativeLuminance(color);

  const eyeKinds: Record<BotMood, readonly ["round" | "teary", "round" | "teary" | "squint"]> = {
    happy: ["round", "round"],
    confused: ["round", "squint"],
    sad: ["teary", "teary"],
  };

  const [leftKind, rightKind] = eyeKinds[mood];

  return {
    back: [
      ...ears(shape, color, ink, mood),
      node("path", { d: foot, fill: color, transform: `translate(0 ${feetY})` }),
      node("path", { d: foot, fill: color, transform: `translate(28 ${feetY})` }),
    ],
    body: cachedFur(`body:${shape}`, BOT_BODY[shape], shapeSeed),
    outline: luminance !== null && luminance > 0.7 ? "rgba(0, 0, 0, 0.14)" : null,
    patch: PATCH,
    eyes: [eye(ink, sparkle, leftKind), eye(ink, sparkle, rightKind)],
    face: face(shape, ink, mood),
  };
}
