import { Predicate } from "effect";
import type { BotAvatar } from "@isnadi/contracts";
import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";
import {
  BOT_ART_LIGHT,
  BOT_EYE_OFFSETS,
  BOT_FACE_LAYOUT,
  botAvatarArt,
  type BotArtNode,
  type BotMood,
} from "@isnadi/client-runtime/bot-avatar-art";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

type BlobRendering = {
  shape: BotBlobShape;
  color: string;
};

/**
 * Native port of the web roster's stitched bot avatars (BotAvatarView.tsx in
 * apps/web), drawn from the same shared art and statically. Native rows never animate; a looping avatar would repaint the
 * list on every frame. Dither and image avatars fall back to a blob so a
 * roster slot is never empty.
 */

type BotBlobShape =
  | "circle"
  | "squircle"
  | "square"
  | "pill"
  | "triangle"
  | "hex"
  | "cloud"
  | "drop";

/** What the bot is doing. Only the face carries it; nothing moves. */
export type BotAvatarState = "idle" | "working" | "needs-you" | "blocked";

const MOOD: Record<BotAvatarState, BotMood> = {
  idle: "happy",
  working: "happy",
  "needs-you": "confused",
  blocked: "sad",
};

const DEFAULT_BLOB_SHAPE: BotBlobShape = "circle";

const DEFAULT_BLOB_COLOR = "#8E8E93";

const BLOB_SHAPES: ReadonlyArray<BotBlobShape> = [
  "circle",
  "squircle",
  "square",
  "pill",
  "triangle",
  "hex",
  "cloud",
  "drop",
];

const BLOB_COLORS: readonly string[] = [
  "#FF4A5A",
  "#FF7A1F",
  "#FFA826",
  "#16C47A",
  "#1FBFAE",
  "#2E8EFF",
  "#9A68FF",
  "#FF4FA8",
  "#A0764F",
  "#8E8E93",
];

/** The muted presets bots were saved with before the palette went vivid. */
const LEGACY_BLOB_COLORS = new Map(
  Object.entries({
    "#E0645C": "#FF4A5A",
    "#E8883A": "#FF7A1F",
    "#D9A833": "#FFA826",
    "#5BA97B": "#16C47A",
    "#4E9BB8": "#1FBFAE",
    "#5B7FD4": "#2E8EFF",
    "#8B6FC9": "#9A68FF",
    "#C96FA8": "#FF4FA8",
    "#7A8699": "#8E8E93",
  } as const),
);

function isBotBlobShape(value: string): value is BotBlobShape {
  return BLOB_SHAPES.some((shape) => shape === value);
}

function isBotAvatarColor(value: string): boolean {
  return Predicate.isString(value) && /^#[\da-f]{6}$/i.test(value);
}

/** Normalizes a stored body color, moving retired presets onto the current palette. */
function resolveBlobColor(value: string): string {
  if (!isBotAvatarColor(value)) return DEFAULT_BLOB_COLOR;
  const color = value.toUpperCase();

  return LEGACY_BLOB_COLORS.get(color) ?? color;
}

function hashSeed(seed: string): number {
  let hash = 5381;

  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) | 0;
  }

  return hash;
}

/** Every avatar kind resolves to a paintable blob (dither/image fall back). */
export function resolveBlobRendering(avatar: BotAvatar | null | undefined): BlobRendering {
  if (avatar?.kind === "dither") {
    const hash = Math.abs(hashSeed(avatar.seed));

    return {
      shape: BLOB_SHAPES[hash % BLOB_SHAPES.length] ?? DEFAULT_BLOB_SHAPE,
      color:
        BLOB_COLORS[Math.floor(hash / BLOB_SHAPES.length) % BLOB_COLORS.length] ??
        DEFAULT_BLOB_COLOR,
    };
  }

  if (avatar?.kind !== "blob") {
    return { shape: DEFAULT_BLOB_SHAPE, color: DEFAULT_BLOB_COLOR };
  }

  return {
    shape: isBotBlobShape(avatar.shape) ? avatar.shape : DEFAULT_BLOB_SHAPE,
    color: resolveBlobColor(avatar.color),
  };
}

const ART_TAGS = { path: Path, ellipse: Ellipse, circle: Circle, rect: Rect } as const;

function ArtNodes({ nodes }: { nodes: ReadonlyArray<BotArtNode> }) {
  return nodes.map((node) => {
    const Tag = ART_TAGS[node.tag];

    return <Tag key={`${node.tag}${JSON.stringify(node.attrs)}`} {...node.attrs} />;
  });
}

/**
 * Renders a bot avatar at a caller-supplied size, statically (no looping
 * animation — that repaints the whole list on high-refresh displays). Image
 * avatars render their stored picture; every other kind resolves to a blob.
 */
export function BotAvatarView(props: {
  readonly avatar: BotAvatar | null | undefined;
  readonly size: number;
  readonly state?: BotAvatarState;
}) {
  if (props.avatar?.kind === "image" && props.avatar.assetPath.length > 0) {
    return (
      <BotImageAvatar assetPath={props.avatar.assetPath} size={props.size} state={props.state} />
    );
  }

  return <BotBlobAvatar avatar={props.avatar} size={props.size} state={props.state} />;
}

/**
 * A bot's uploaded picture. `assetPath` is a self-contained data URL written
 * by the avatar picker, so there is no environment URL to resolve. The blob
 * sits underneath and takes over if the picture cannot be decoded, so a
 * roster slot is never empty.
 */
function BotImageAvatar(props: {
  readonly assetPath: string;
  readonly size: number;
  readonly state?: BotAvatarState;
}) {
  const [failedPath, setFailedPath] = useState<string | null>(null);

  if (failedPath === props.assetPath) {
    return <BotBlobAvatar avatar={null} size={props.size} state={props.state} />;
  }

  return (
    <View style={{ height: props.size, width: props.size }}>
      <BotBlobAvatar avatar={null} size={props.size} state={props.state} />
      <Image
        source={{ uri: props.assetPath }}
        accessibilityIgnoresInvertColors
        cachePolicy="memory-disk"
        contentFit="cover"
        onError={() => setFailedPath(props.assetPath)}
        style={{
          borderRadius: props.size / 2,
          height: props.size,
          left: 0,
          position: "absolute",
          top: 0,
          width: props.size,
        }}
      />
    </View>
  );
}

function BotBlobAvatar(props: {
  readonly avatar: BotAvatar | null | undefined;
  readonly size: number;
  readonly state?: BotAvatarState;
}) {
  const { shape, color } = resolveBlobRendering(props.avatar);
  const state = props.state ?? "idle";
  const mood = MOOD[state];
  const art = botAvatarArt(shape, color, mood);
  const face = BOT_FACE_LAYOUT[shape];
  const id = `bot-${shape}-${color.slice(1)}-${mood}`;

  return (
    <View style={{ height: props.size, width: props.size }}>
      <Svg height={props.size} viewBox="-4 -4 108 108" width={props.size}>
        <Defs>
          <RadialGradient
            id={`${id}-light`}
            cx={BOT_ART_LIGHT.cx}
            cy={BOT_ART_LIGHT.cy}
            r={BOT_ART_LIGHT.r}
          >
            {BOT_ART_LIGHT.stops.map((stop) => (
              <Stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </RadialGradient>
          <ClipPath id={`${id}-clip`}>
            <Path d={art.body} />
          </ClipPath>
        </Defs>
        <ArtNodes nodes={art.back} />
        {art.outline ? (
          <Path d={art.body} fill="none" stroke={art.outline} strokeWidth={3} />
        ) : null}
        <Path d={art.body} fill={color} />
        <Path d={art.body} fill={`url(#${id}-light)`} />
        <G clipPath={`url(#${id}-clip)`}>
          <ArtNodes nodes={art.patch} />
        </G>
        {([0, 1] as const).map((index) => (
          <G
            key={index}
            transform={`translate(${face.x + BOT_EYE_OFFSETS[index].x * face.scale} ${face.y + BOT_EYE_OFFSETS[index].y * face.scale}) scale(${face.scale})`}
          >
            <ArtNodes nodes={art.eyes[index]} />
          </G>
        ))}
        <ArtNodes nodes={art.face} />
      </Svg>
    </View>
  );
}

/**
 * Deterministic blob avatar/**
 * Deterministic blob avatar for threads without a configured bot: the same
 * seed (provider driver or thread id) always yields the same body, so rows
 * stay stable across renders and sessions.
 */
export function seededBlobAvatar(seed: string): BotAvatar {
  const positive = Math.abs(hashSeed(seed));

  return {
    kind: "blob",
    shape: BLOB_SHAPES[positive % BLOB_SHAPES.length]!,
    color: BLOB_COLORS[Math.floor(positive / BLOB_SHAPES.length) % BLOB_COLORS.length]!,
  };
}
