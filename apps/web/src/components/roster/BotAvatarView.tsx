import { createElement, useEffect, useId, useRef, type RefObject } from "react";
import {
  BOT_ART_LIGHT,
  BOT_EYE_OFFSETS,
  BOT_FACE_LAYOUT,
  botAvatarArt,
  type BotArtNode,
  type BotMood,
} from "@isnadi/client-runtime/bot-avatar-art";

import { cn } from "~/lib/utils";
import { IDLE_BEAT_LENGTH_MS, subscribeIdleBeat } from "./botAvatarIdleBeat";
import { BotMotion, REST_FRAME, wrapOnBelt, type MotionFrame } from "./botAvatarMotion";
import { botAvatarSeed, resolveBlobRendering } from "./roster.logic";
import type { BotAvatar, BotBlobShape } from "./types";

/**
 * What a bot is doing. `working` sways, glances down at its work, and spins
 * now and then for as long as the turn runs; the others rest still and only
 * move on hover or during the rare idle beat. The face carries the state:
 * idle and working grin, needs-you looks puzzled, blocked looks sad.
 */
export type BotAnimationState = "idle" | "working" | "needs-you" | "blocked";

const MOOD: Record<BotAnimationState, BotMood> = {
  idle: "happy",
  working: "happy",
  "needs-you": "confused",
  blocked: "sad",
};

/** Minimum frame spacing for the working pose, about 30fps with rAF jitter headroom. */
const WORKING_FRAME_MS = 1000 / 30 - 2;

/** Radius the face travels on when it spins around the body. */
const BELT_RADIUS = 44;

/** Where the face center sits for a motion frame. */
function facePosition(shape: BotBlobShape, frame: MotionFrame) {
  const face = BOT_FACE_LAYOUT[shape];
  const pull = 0.42 * frame.pull;

  return {
    face,
    x: face.x + (50 - face.x) * pull + frame.gazeX * face.scale,
    y: face.y + (50 - face.y) * pull + frame.gazeY * face.scale,
  };
}

/** Places one eye for a motion frame, or returns null while it is behind the body. */
function eyeTransform(shape: BotBlobShape, frame: MotionFrame, index: 0 | 1) {
  const { face, x: faceX, y: faceY } = facePosition(shape, frame);
  const offset = BOT_EYE_OFFSETS[index];
  let x = faceX + offset.x * face.scale;
  const y = faceY + offset.y * face.scale;
  let width = frame.eyeWidth * face.scale;

  if (frame.spin !== 0) {
    const wrapped = wrapOnBelt(x, 50, BELT_RADIUS, frame.spin);

    if (!wrapped) return null;
    x = wrapped.x;
    width *= wrapped.width;
  }

  const height = frame.eyeHeight[index] * face.scale;

  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${width.toFixed(3)} ${height.toFixed(3)})`;
}

/** Moves the mouth, brows and cheeks with the eyes, or hides them while the face spins. */
function faceTransform(shape: BotBlobShape, frame: MotionFrame) {
  if (frame.spin !== 0) return null;
  const { face, x, y } = facePosition(shape, frame);

  return `translate(${(x - face.x).toFixed(2)} ${(y - face.y).toFixed(2)})`;
}

function bodyTransform(frame: MotionFrame) {
  return `translate(${frame.x.toFixed(2)}%, ${frame.y.toFixed(2)}%) rotate(${frame.roll.toFixed(2)}deg) scale(1, ${frame.scaleY.toFixed(4)})`;
}

function ArtNodes({ nodes }: { nodes: ReadonlyArray<BotArtNode> }) {
  return nodes.map((node, index) => createElement(node.tag, { key: index, ...node.attrs }));
}

type FaceRefs = {
  eyes: RefObject<Array<SVGGElement | null>>;
  face: RefObject<SVGGElement | null>;
};

/**
 * The stitched bot: ears and feet behind a furry body, a soft light, a sewn-on
 * patch, and a face that shows the bot's mood. The motion engine rewrites the
 * eye and face transforms.
 */
function BlobFigure({
  shape,
  color,
  mood,
  refs,
}: {
  shape: BotBlobShape;
  color: string;
  mood: BotMood;
  refs: FaceRefs;
}) {
  const id = `bot-${useId().replace(/[^\w-]/g, "")}`;
  const art = botAvatarArt(shape, color, mood);

  return (
    <>
      <defs>
        <radialGradient
          id={`${id}-light`}
          cx={BOT_ART_LIGHT.cx}
          cy={BOT_ART_LIGHT.cy}
          r={BOT_ART_LIGHT.r}
        >
          {BOT_ART_LIGHT.stops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stop.color}
              stopOpacity={stop.opacity}
            />
          ))}
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <path d={art.body} />
        </clipPath>
      </defs>
      <ArtNodes nodes={art.back} />
      {art.outline && <path d={art.body} fill="none" stroke={art.outline} strokeWidth="3" />}
      <path d={art.body} fill={color} />
      <path d={art.body} fill={`url(#${id}-light)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <ArtNodes nodes={art.patch} />
      </g>
      <g className="bot-eyes">
        {([0, 1] as const).map((index) => (
          <g
            key={index}
            ref={(node) => {
              refs.eyes.current[index] = node;
            }}
            transform={eyeTransform(shape, REST_FRAME, index) ?? undefined}
          >
            <ArtNodes nodes={art.eyes[index]} />
          </g>
        ))}
      </g>
      <g ref={refs.face}>
        <ArtNodes nodes={art.face} />
      </g>
    </>
  );
}

/**
 * A flat blob avatar with a face, moved by a spring engine (see
 * botAvatarMotion). It animates only while the bot works, while the pointer
 * is over the avatar or its `[data-bot-hover]` row, and for the rare idle
 * beat. Hovered eyes follow the pointer. The frame loop stops once the springs
 * settle and pauses while the avatar is off screen.
 */
function BlobAvatar({
  shape,
  color,
  name,
  state,
  className,
}: {
  shape: BotBlobShape;
  color: string;
  name: string;
  state: BotAnimationState;
  className?: string | undefined;
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const eyeRefs = useRef<Array<SVGGElement | null>>([null, null]);
  const faceRef = useRef<SVGGElement | null>(null);
  const working = state === "working";
  const workingRef = useRef(working);
  const wakeRef = useRef<() => void>(() => {});
  const motionRef = useRef<BotMotion | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const body = bodyRef.current;

    if (!wrapper || !body) return;
    const motion = (motionRef.current = new BotMotion(botAvatarSeed(name)));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hoverTarget = wrapper.closest<HTMLElement>("[data-bot-hover]") ?? wrapper;
    let hovered = false;
    let pointer: { x: number; y: number } | null = null;
    let visible = true;
    let frameId: number | null = null;
    let last = 0;
    // Last values written to the DOM, so settled or repeated poses cost no style work.
    let lastBody = "";

    // A mood change replaces the eye nodes, so the cache is per node.
    const lastEyes: Array<{
      node: SVGGElement | null;
      transform: string | null;
      visible: boolean | null;
    }> = [
      { node: null, transform: null, visible: null },
      { node: null, transform: null, visible: null },
    ];

    let lastFaceNode: SVGGElement | null = null;
    let lastFaceTransform: string | null = null;

    const render = (frame: MotionFrame) => {
      const nextBody = bodyTransform(frame);

      if (nextBody !== lastBody) {
        body.style.transform = nextBody;
        lastBody = nextBody;
      }

      for (const index of [0, 1] as const) {
        const eye = eyeRefs.current[index];
        const written = lastEyes[index];

        if (!eye || !written) continue;

        if (written.node !== eye) {
          written.node = eye;
          written.transform = null;
          written.visible = null;
        }

        const transform = eyeTransform(shape, frame, index);
        const visible = transform !== null;

        if (visible !== written.visible) {
          eye.setAttribute("visibility", visible ? "visible" : "hidden");
          written.visible = visible;
        }

        if (transform && transform !== written.transform) {
          eye.setAttribute("transform", transform);
          written.transform = transform;
        }
      }

      const face = faceRef.current;

      if (face) {
        if (lastFaceNode !== face) {
          lastFaceNode = face;
          lastFaceTransform = null;
        }

        const transform = faceTransform(shape, frame);

        if (transform !== lastFaceTransform) {
          face.setAttribute("visibility", transform === null ? "hidden" : "visible");

          if (transform !== null) face.setAttribute("transform", transform);
          lastFaceTransform = transform;
        }
      }
    };

    const tick = (time: number) => {
      // The continuous working bob reads fine at 30fps. Hover tracking and the spin keep
      // the full display rate.
      if (
        last !== 0 &&
        workingRef.current &&
        !hovered &&
        !motion.spinning &&
        time - last < WORKING_FRAME_MS
      ) {
        frameId = visible ? requestAnimationFrame(tick) : null;

        if (frameId === null) last = 0;

        return;
      }

      const dt = last === 0 ? 1 / 60 : (time - last) / 1000;
      last = time;

      const { frame, active } = motion.tick(dt, {
        working: workingRef.current,
        hovered,
        pointer,
        reducedMotion: reducedMotion.matches,
      });

      render(frame);
      frameId = active && visible ? requestAnimationFrame(tick) : null;

      if (frameId === null) last = 0;
    };

    const wake = () => {
      if (frameId === null && visible) frameId = requestAnimationFrame(tick);
    };

    wakeRef.current = wake;

    const onEnter = (event: PointerEvent) => {
      hovered = true;
      onMove(event);
      wake();
    };

    const onMove = (event: PointerEvent) => {
      const rect = wrapper.getBoundingClientRect();
      const clamp = (value: number) => Math.max(-0.6, Math.min(0.6, value)) / 0.6;
      pointer = {
        x: clamp((event.clientX - (rect.left + rect.width / 2)) / Math.max(rect.width, 1)),
        y: clamp((event.clientY - (rect.top + rect.height / 2)) / Math.max(rect.height, 1)),
      };
    };

    const onLeave = () => {
      hovered = false;
      pointer = null;
      wake();
    };

    reducedMotion.addEventListener("change", wake);
    hoverTarget.addEventListener("pointerenter", onEnter);
    hoverTarget.addEventListener("pointermove", onMove);
    hoverTarget.addEventListener("pointerleave", onLeave);

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;

      if (visible) wake();
    });

    observer.observe(wrapper);
    wake();

    return () => {
      reducedMotion.removeEventListener("change", wake);
      hoverTarget.removeEventListener("pointerenter", onEnter);
      hoverTarget.removeEventListener("pointermove", onMove);
      hoverTarget.removeEventListener("pointerleave", onLeave);
      observer.disconnect();

      if (frameId !== null) cancelAnimationFrame(frameId);
      wakeRef.current = () => {};

      motionRef.current = null;
    };
  }, [name, shape]);

  useEffect(() => {
    workingRef.current = working;
    wakeRef.current();
  }, [working]);

  useEffect(() => {
    const wrapper = wrapperRef.current;

    if (!wrapper || working) return;

    return subscribeIdleBeat(wrapper, () => {
      motionRef.current?.beat(IDLE_BEAT_LENGTH_MS);
      wakeRef.current();
    });
  }, [working]);

  return (
    <span
      ref={wrapperRef}
      aria-hidden
      className={cn("bot-avatar relative inline-block shrink-0 select-none", className)}
      data-avatar-shape={shape}
      data-bot-state={state}
    >
      <span ref={bodyRef} className="bot-body">
        <svg viewBox="-4 -4 108 108" overflow="visible" className="size-full">
          <BlobFigure
            shape={shape}
            color={color}
            mood={MOOD[state]}
            refs={{ eyes: eyeRefs, face: faceRef }}
          />
        </svg>
      </span>
    </span>
  );
}

/**
 * Renders any bot avatar at a caller-supplied size. Image avatars paint the
 * asset; everything else draws as a blob, with legacy dither seeds picking its
 * shape and color. Malformed data falls back to the default blob. `name`
 * offsets the motion so a row of working bots does not bob in unison.
 */
export function BotAvatarView({
  avatar,
  name,
  state = "idle",
  className,
}: {
  avatar: BotAvatar;
  name: string;
  state?: BotAnimationState;
  className?: string;
}) {
  if (avatar.kind === "image" && avatar.assetPath.length > 0) {
    return (
      <img
        src={avatar.assetPath}
        alt=""
        aria-hidden
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  const { shape, color } = resolveBlobRendering(avatar);

  return <BlobAvatar shape={shape} color={color} name={name} state={state} className={className} />;
}
