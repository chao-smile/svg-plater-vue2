<template>
  <div
    class="root"
    :class="{ 'blend-supported': supportsBlendMode, 'text-mode-root': displayMode === 'text' }"
    :style="themeVars"
  >
    <div class="status" v-if="playerState === 'loading' || playerState === 'error'">
      <span v-if="playerState === 'loading'">加载段落数据中...</span>
      <span v-else-if="playerState === 'error'" class="err">{{
        errorText
      }}</span>
    </div>

    <div
      class="stage"
      v-if="
        displayMode === 'image' &&
        imageUrl &&
        imageWidth > 0 &&
        imageHeight > 0
      "
    >
      <img class="image" :src="imageUrl" alt="shared image" />
      <svg
        v-if="segments.length"
        class="overlay"
        :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <clipPath
            v-for="item in clipRuns"
            :key="item.run.id"
            :id="`clip-${item.run.id}`"
            clipPathUnits="userSpaceOnUse"
          >
            <rect
              :x="item.run.expandedBBox.x"
              :y="item.run.expandedBBox.y"
              :width="
                item.run.expandedBBox.w *
                (item.segmentId === activeSegmentIdValue
                  ? runProgress[item.run.id] || 0
                  : 0)
              "
              :height="item.run.expandedBBox.h"
              :rx="highlightRadius"
              :ry="highlightRadius"
            />
          </clipPath>
        </defs>

        <g v-for="segment in segments" :key="segment.id">
          <g v-for="run in segment.runs" :key="run.id">
            <rect
              v-if="props.showOutline"
              class="base"
              :class="{ active: segment.id === activeSegmentIdValue }"
              :x="run.expandedBBox.x"
              :y="run.expandedBBox.y"
              :width="run.expandedBBox.w"
              :height="run.expandedBBox.h"
              :rx="highlightRadius"
              :ry="highlightRadius"
            />
            <rect
              class="fill"
              :x="run.expandedBBox.x"
              :y="run.expandedBBox.y"
              :width="run.expandedBBox.w"
              :height="run.expandedBBox.h"
              :clip-path="`url(#clip-${run.id})`"
              :rx="highlightRadius"
              :ry="highlightRadius"
            />
          </g>
        </g>
      </svg>
    </div>

    <div
      v-else-if="displayMode === 'text' && segments.length"
      ref="textStageRef"
      class="text-stage"
      @scroll.passive="handleTextStageScroll"
      @wheel.passive="handleTextStageUserInteraction"
      @touchstart.passive="handleTextStageUserInteraction"
    >
      <div class="text-content">
        <div aria-hidden="true" class="text-spacer" :style="textSpacerStyle" />
        <p
          v-for="(line, index) in textLines"
          :key="line.id"
          :ref="(el) => bindTextLineEl(line.id, el)"
          class="text-segment"
          :class="{ active: index === activeTextLineIndex }"
          :style="textLineStyle(index, line)"
        >
          {{ line.text }}
        </p>
        <div aria-hidden="true" class="text-spacer" :style="textSpacerStyle" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Vue from "vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  reactive,
  ref,
  watch,
} from "vue";
import { computeRunProgress, loadSegmentModels } from "./model";
import type {
  PlayerState,
  RunModel,
  SegmentAsset,
  SegmentModel,
  SvgSequencePlayerExpose,
  SvgSequencePlayerProgress,
} from "./types";

type DisplayMode = "image" | "text";
type PlaybackScope = "all" | "single";
type TextWordProgressCue = {
  id: string;
  t0: number;
  t1: number;
  startUnit: number;
  endUnit: number;
};
type TextLineModel = {
  id: string;
  text: string;
  segmentIndex: number;
  segmentId: string;
  t0: number;
  t1: number;
  totalUnits: number;
  wordCues: TextWordProgressCue[];
};

// 组件入参：图片地址、分段资源与播放器外观/行为配置。
const props = withDefaults(
  defineProps<{
    imageUrl: string;
    segmentAssets: SegmentAsset[];
    sourceImageWidth?: number;
    sourceImageHeight?: number;
    showOutline?: boolean;
    highlightColor?: string;
    highlightRadius?: number;
    playbackRate?: number;
    displayMode?: DisplayMode;
    autoFollowText?: boolean;
    autoFollowResumeDelayMs?: number;
  }>(),
  {
    showOutline: false,
    highlightColor: "#f2b4ae",
    highlightRadius: 0,
    playbackRate: 1,
    displayMode: "image",
    autoFollowText: true,
    autoFollowResumeDelayMs: 1800,
  },
);

// 对外事件：播放完成与内部状态变化。
const emit = defineEmits<{
  (e: "finished"): void;
  (e: "state-change", state: PlayerState): void;
  (e: "progress-change", progress: SvgSequencePlayerProgress): void;
}>();

// 播放器当前状态（loading/idle/playing/paused/error）。
const playerState = ref<PlayerState>("loading");
// 错误文本：模型加载或播放失败时展示。
const errorText = ref("");
// 图片坐标系宽度（用于 SVG overlay viewBox）。
const imageWidth = ref(0);
// 图片坐标系高度（用于 SVG overlay viewBox）。
const imageHeight = ref(0);
// 归一化后的分段模型数组。
const segments = ref<SegmentModel[]>([]);
// 当前活跃分段索引，-1 表示无活跃分段。
const currentSegmentIndex = ref<number>(-1);
// 当前播放时间（毫秒）。
const currentTimeMs = ref(0);
// 每个 run 的高亮进度缓存（0~1）。
const runProgress = reactive<Record<string, number>>({});
// 文本模式滚动容器引用。
const textStageRef = ref<HTMLElement | null>(null);
// 文本行 DOM 索引（line.id -> HTMLElement）。
const textLineEls = new Map<string, HTMLElement>();
// 文本容器高度缓存，用于顶部/底部 spacer 计算。
const textStageHeight = ref(0);
// 文本容器 ResizeObserver 实例。
let textStageResizeObserver: ResizeObserver | null = null;
// 当前被观察的文本容器节点，用于避免重复绑定 observer。
let observedTextStageEl: HTMLElement | null = null;
// 是否允许自动跟随文本到激活行。
const textAutoFollowAllowed = ref(true);
// 自动跟随恢复定时器 id。
let textAutoFollowResumeTimer = 0;
// 程序滚动锁截止时间：在这之前忽略 scroll 事件，避免程序滚动被误判为手动滚动。
let programmaticScrollLockUntil = 0;

// 全局复用的底层音频实例。
const audio = new Audio();
// requestAnimationFrame 句柄。
let raf = 0;
// 当前分段停止时间（毫秒）。
let stopAtMs: number | null = null;
// 播放流程令牌：用于中断旧异步流程。
let sequenceToken = 0;
// 数据加载令牌：用于忽略过期的异步模型构建结果。
let modelLoadToken = 0;
// 当前模型加载 Promise；外部播放调用会等待它完成，避免异步 props 刚更新时播放无响应。
let pendingModelLoad: Promise<boolean> | null = null;
// 当前分段播放 Promise 的 resolve 回调。
let resolveSegment: ((ok: boolean) => void) | null = null;
// 当前分段事件监听清理函数。
let cleanupSegmentListeners: (() => void) | null = null;
// 上一次渲染的分段索引。
let lastRenderedSegmentIndex = -1;
// 上一次已居中的文本行 id（用于避免同一行重复触发滚动动画）。
let lastCenteredTextLineId = "";
// 上一次倍速快照（避免重复写入 audio.playbackRate）。
let prevPlaybackRate = NaN;
// 上一次展示模式快照（用于模式切换副作用控制）。
let prevDisplayMode: DisplayMode | null = null;
// 上一次自动跟随开关快照。
let prevAutoFollowText: boolean | null = null;
// 当前播放范围：顺序播放全部，或只播放单个分段。
let playbackScope: PlaybackScope | null = null;

// 更新并广播播放器状态，避免重复派发相同状态。
function setState(next: PlayerState) {
  if (playerState.value === next) return;
  playerState.value = next;
  emit("state-change", next);
}

// 停止当前 RAF 循环，终止逐帧进度更新。
function stopRaf() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

// 将外部倍速同步到底层 audio 对象。
function applyPlaybackRate(rate: number) {
  audio.playbackRate = rate;
  // Keep pitch when changing speed to reduce chipmunk-like distortion.
  const media = audio as HTMLMediaElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  if ("preservesPitch" in media) media.preservesPitch = true;
  if ("mozPreservesPitch" in media) media.mozPreservesPitch = true;
  if ("webkitPreservesPitch" in media) media.webkitPreservesPitch = true;
}

function setRunProgress(runId: string, value: number) {
  Vue.set(runProgress, runId, value);
}

// 重置所有分段/行的高亮进度。
function resetAllProgress() {
  for (const segment of segments.value) {
    for (const run of segment.runs) setRunProgress(run.id, 0);
  }
}

// 仅重置指定分段的行进度，用于切换分段时清理历史痕迹。
function resetSegmentRunProgress(segmentIndex: number) {
  const segment = segments.value[segmentIndex];
  if (!segment) return;
  for (const run of segment.runs) setRunProgress(run.id, 0);
}

// 结束当前 segment 的等待 Promise（成功/失败）。
function settleSegment(ok: boolean) {
  if (!resolveSegment) return;
  cleanupSegmentListeners?.();
  cleanupSegmentListeners = null;
  const fn = resolveSegment;
  resolveSegment = null;
  fn(ok);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function segmentDuration(segment: SegmentModel | undefined) {
  if (!segment) return 0;
  return Math.max(0, segment.t1 - segment.t0);
}

function totalDuration() {
  return segments.value.reduce((sum, segment) => sum + segmentDuration(segment), 0);
}

function elapsedBeforeSegment(index: number) {
  return segments.value
    .slice(0, Math.max(0, index))
    .reduce((sum, segment) => sum + segmentDuration(segment), 0);
}

function buildProgressPayload(): SvgSequencePlayerProgress {
  const activeIndex = currentSegmentIndex.value;
  const segment = segments.value[activeIndex];
  const durationMs = totalDuration();
  if (!segment) {
    return {
      segmentIndex: -1,
      segmentId: null,
      segmentCount: segments.value.length,
      currentTimeMs: 0,
      durationMs,
      segmentTimeMs: 0,
      segmentDurationMs: 0,
      progress: 0,
    };
  }

  const segmentDurationMs = segmentDuration(segment);
  const segmentTimeMs = clamp(currentTimeMs.value - segment.t0, 0, segmentDurationMs);
  const totalTimeMs = clamp(
    elapsedBeforeSegment(activeIndex) + segmentTimeMs,
    0,
    durationMs,
  );

  return {
    segmentIndex: activeIndex,
    segmentId: segment.id,
    segmentCount: segments.value.length,
    currentTimeMs: totalTimeMs,
    durationMs,
    segmentTimeMs,
    segmentDurationMs,
    progress: durationMs > 0 ? clamp(totalTimeMs / durationMs, 0, 1) : 0,
  };
}

function emitProgressChange() {
  emit("progress-change", buildProgressPayload());
}

function resolvePositionByProgress(progress: number) {
  const durationMs = totalDuration();
  const safeProgress = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  if (!segments.value.length || durationMs <= 0) {
    return { index: -1, timeMs: 0 };
  }

  let elapsed = safeProgress * durationMs;
  for (let index = 0; index < segments.value.length; index += 1) {
    const segment = segments.value[index]!;
    const duration = segmentDuration(segment);
    if (elapsed <= duration || index === segments.value.length - 1) {
      return {
        index,
        timeMs: clamp(segment.t0 + elapsed, segment.t0, segment.t1),
      };
    }
    elapsed -= duration;
  }

  const lastIndex = segments.value.length - 1;
  const last = segments.value[lastIndex]!;
  return { index: lastIndex, timeMs: last.t1 };
}

function renderSegmentProgressAt(index: number, timeMs: number) {
  const segment = segments.value[index];
  if (!segment) return;
  resetAllProgress();
  currentSegmentIndex.value = index;
  currentTimeMs.value = clamp(timeMs, segment.t0, segment.t1);
  lastRenderedSegmentIndex = index;
  for (const run of segment.runs) {
    setRunProgress(run.id, computeRunProgress(run, currentTimeMs.value));
  }
  syncTextFollowOnPlayback();
  emitProgressChange();
}

// 获取当前活跃分段 id（无活跃分段时返回 null）。
const activeSegmentIdValue = computed(() => {
  const idx = currentSegmentIndex.value;
  if (idx < 0 || idx >= segments.value.length) return null;
  return segments.value[idx]?.id ?? null;
});

const clipRuns = computed(() =>
  segments.value.flatMap((segment) =>
    segment.runs.map((run) => ({
      segmentId: segment.id,
      run,
    })),
  ),
);

// 播放中同步文本跟随：仅在“活跃行变化”时触发平滑滚动。
function syncTextFollowOnPlayback() {
  if (!shouldAutoFollowText()) return;
  const idx = activeTextLineIndex.value;
  if (idx < 0) return;
  const line = textLines.value[idx];
  if (!line) return;
  if (line.id === lastCenteredTextLineId) return;
  lastCenteredTextLineId = line.id;
  centerActiveTextLine("smooth");
}

// 同步“当前已居中文本行”标记，避免首帧重复触发平滑滚动。
function syncCenteredLineMarker() {
  const idx = activeTextLineIndex.value;
  if (idx < 0) {
    lastCenteredTextLineId = "";
    return;
  }
  const line = textLines.value[idx];
  lastCenteredTextLineId = line?.id ?? "";
}

// 计算“首次进入文本模式”应该定位到的行（通常是首段最早时间行）。
function resolveInitialTextLineId() {
  const lines = textLines.value;
  if (!lines.length) return "";
  const firstSegmentLines = lines.filter((line) => line.segmentIndex === 0);
  if (!firstSegmentLines.length) return lines[0]?.id ?? "";
  const firstLine = firstSegmentLines.reduce((best, current) =>
    current.t0 < best.t0 ? current : best,
  );
  return firstLine.id;
}

// 播放中的逐帧主循环：推进高亮进度并处理分段结束。
function tick() {
  const activeIndex = currentSegmentIndex.value;
  const active = segments.value[activeIndex];
  if (!active) {
    stopRaf();
    return;
  }

  const tMs = audio.currentTime * 1000;
  currentTimeMs.value = tMs;
  // 按当前音频时间推进每一行 run 的高亮进度，拖拽回退时也能精确同步。
  for (const run of active.runs) {
    const next = computeRunProgress(run, tMs);
    setRunProgress(run.id, next);
  }
  syncTextFollowOnPlayback();
  emitProgressChange();

  if (stopAtMs != null && tMs >= stopAtMs) {
    for (const run of active.runs) setRunProgress(run.id, 1);
    audio.pause();
    stopRaf();
    settleSegment(true);
    return;
  }

  raf = requestAnimationFrame(tick);
}

// 跳转音频到指定毫秒，带 token 防抖避免过期流程继续执行。
function seekToMs(ms: number, token: number) {
  const target = ms / 1000;
  if (Math.abs(audio.currentTime - target) < 0.015) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let done = false;
    const onSeeked = () => {
      if (done) return;
      done = true;
      resolve();
    };
    audio.addEventListener("seeked", onSeeked, { once: true });
    audio.currentTime = target;
    window.setTimeout(() => {
      if (done) return;
      done = true;
      resolve();
    }, 250);
  }).then(() => {
    if (token !== sequenceToken) throw new Error("stale");
  });
}

async function prepareSegmentAtPosition(
  index: number,
  timeMs: number,
  token: number,
): Promise<boolean> {
  const segment = segments.value[index];
  if (!segment) return false;

  if (lastRenderedSegmentIndex >= 0 && lastRenderedSegmentIndex !== index) {
    resetSegmentRunProgress(lastRenderedSegmentIndex);
  }
  stopAtMs = segment.t1;
  renderSegmentProgressAt(index, timeMs);

  if (audio.src !== segment.audioUrl) {
    audio.src = segment.audioUrl;
    audio.preload = "auto";
    audio.load();
  }

  try {
    applyPlaybackRate(effectivePlaybackRate.value);
    await seekToMs(clamp(timeMs, segment.t0, segment.t1), token);
    if (token !== sequenceToken) return false;
    renderSegmentProgressAt(index, audio.currentTime * 1000);
    // 每个分段开播前先把首句“无动画居中”，避免刚播放就先滚一下。
    centerActiveTextLine("auto", true);
    syncCenteredLineMarker();
    return true;
  } catch (e) {
    if (String((e as Error)?.message ?? e) !== "stale") {
      console.error(e);
    }
    return false;
  }
}

// 内部播放单个分段并返回是否成功完成，由连续播放和对外单段播放共同复用。
async function playSegmentInternal(
  index: number,
  token: number,
  startAtMs?: number,
): Promise<boolean> {
  const segment = segments.value[index];
  if (!segment) return false;

  const prepared = await prepareSegmentAtPosition(
    index,
    startAtMs == null ? segment.t0 : startAtMs,
    token,
  );
  if (!prepared || token !== sequenceToken) return false;

  try {
    await audio.play();
    if (token !== sequenceToken) return false;
    applyPlaybackRate(effectivePlaybackRate.value);

    // RAF 驱动视觉更新，避免只靠 audio 事件导致更新不连续。
    stopRaf();
    raf = requestAnimationFrame(tick);
  } catch (e) {
    if (String((e as Error)?.message ?? e) !== "stale") {
      console.error(e);
    }
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const onEnded = () => settleSegment(true);
    const onError = () => settleSegment(false);
    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });

    cleanupSegmentListeners = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };

    resolveSegment = resolve;
  });
}

function setCompletedPosition(index: number) {
  const segment = segments.value[index];
  if (!segment) {
    currentSegmentIndex.value = -1;
    currentTimeMs.value = 0;
    emitProgressChange();
    return;
  }
  renderSegmentProgressAt(index, segment.t1);
}

// 内部停止：中断当前流程并重置状态（可选择是否回到 idle/error）。
function stopInternal(setIdleState = true) {
  sequenceToken += 1;
  stopAtMs = null;
  lastRenderedSegmentIndex = -1;
  currentTimeMs.value = 0;
  audio.pause();
  stopRaf();
  settleSegment(false);
  currentSegmentIndex.value = -1;
  lastCenteredTextLineId = "";
  programmaticScrollLockUntil = 0;
  resetAllProgress();
  emitProgressChange();
  if (setIdleState) playbackScope = null;
  if (setIdleState) setState(errorText.value ? "error" : "idle");
}

async function playAllFromPosition(startIndex = 0, startAtMs?: number) {
  if (!(await waitForModelReady())) return;
  if (
    !segments.value.length ||
    playerState.value === "error"
  )
    return;

  stopInternal(false);
  resetAllProgress();
  playbackScope = "all";
  setState("playing");

  sequenceToken += 1;
  const token = sequenceToken;
  const firstIndex = clamp(Math.floor(startIndex), 0, segments.value.length - 1);

  for (let i = firstIndex; i < segments.value.length; i++) {
    const ok = await playSegmentInternal(
      i,
      token,
      i === firstIndex ? startAtMs : undefined,
    );
    if (!ok || token !== sequenceToken) return;
  }

  audio.pause();
  stopRaf();
  lastRenderedSegmentIndex = -1;
  setCompletedPosition(segments.value.length - 1);
  playbackScope = null;
  setState("idle");
  emit("finished");
}

async function playSingleFromPosition(index: number, startAtMs?: number) {
  if (!(await waitForModelReady())) return;
  if (
    !segments.value[index] ||
    playerState.value === "error"
  )
    return;

  stopInternal(false);
  resetAllProgress();
  playbackScope = "single";
  setState("playing");

  sequenceToken += 1;
  const token = sequenceToken;
  const ok = await playSegmentInternal(index, token, startAtMs);
  if (!ok || token !== sequenceToken) return;

  audio.pause();
  stopRaf();
  lastRenderedSegmentIndex = -1;
  setCompletedPosition(index);
  playbackScope = null;
  setState("idle");
}

// 串行播放全部 segments；若 token 变化说明被中断，立即退出。
async function playAll() {
  await playAllFromPosition();
}

// 对外播放指定分段：保留完整数据源，只重置播放状态并定位到目标段。
async function playSegment(index: number) {
  await playSingleFromPosition(index);
}

// 暂停播放并保持当前进度。
function pause() {
  if (playerState.value !== "playing") return;
  audio.pause();
  stopRaf();
  setState("paused");
}

// 从暂停状态恢复播放。
async function resume() {
  if (playerState.value === "idle" && currentSegmentIndex.value >= 0) {
    const scope = playbackScope ?? "all";
    const index = currentSegmentIndex.value;
    const timeMs = currentTimeMs.value;
    if (scope === "single") {
      void playSingleFromPosition(index, timeMs);
    } else {
      void playAllFromPosition(index, timeMs);
    }
    return;
  }
  if (playerState.value !== "paused") return;
  if (!resolveSegment && currentSegmentIndex.value >= 0) {
    const scope = playbackScope ?? "all";
    const index = currentSegmentIndex.value;
    const timeMs = currentTimeMs.value;
    if (scope === "single") {
      void playSingleFromPosition(index, timeMs);
    } else {
      void playAllFromPosition(index, timeMs);
    }
    return;
  }
  try {
    await audio.play();
    setState("playing");
    stopRaf();
    raf = requestAnimationFrame(tick);
  } catch (e) {
    console.error(e);
  }
}

// 根据当前状态在暂停/继续之间切换。
function togglePause() {
  if (playerState.value === "playing") {
    pause();
    return;
  }
  if (playerState.value === "paused") {
    void resume();
  }
}

// 对外暴露的停止动作，结束当前播放并回到可重播状态。
function stop() {
  stopInternal(true);
}

async function seekToProgress(progress: number) {
  if (!(await waitForModelReady())) return;
  const target = resolvePositionByProgress(progress);
  if (target.index < 0) return;

  const wasPlaying = playerState.value === "playing";
  const wasPaused = playerState.value === "paused";
  const scope = playbackScope ?? "all";

  if (wasPlaying) {
    if (scope === "single") {
      void playSingleFromPosition(target.index, target.timeMs);
    } else {
      void playAllFromPosition(target.index, target.timeMs);
    }
    return;
  }

  stopInternal(false);
  playbackScope = scope;
  const token = sequenceToken;
  const ok = await prepareSegmentAtPosition(target.index, target.timeMs, token);
  if (!ok || token !== sequenceToken) return;
  setState(wasPaused ? "paused" : "idle");
}

async function seekSegmentToProgress(index: number, progress: number) {
  if (!(await waitForModelReady())) return;
  const segment = segments.value[index];
  if (!segment) return;

  const safeProgress = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const targetTimeMs = segment.t0 + segmentDuration(segment) * safeProgress;
  const wasPlaying = playerState.value === "playing";
  const wasPaused = playerState.value === "paused";

  if (wasPlaying) {
    void playSingleFromPosition(index, targetTimeMs);
    return;
  }

  stopInternal(false);
  playbackScope = "single";
  const token = sequenceToken;
  const ok = await prepareSegmentAtPosition(index, targetTimeMs, token);
  if (!ok || token !== sequenceToken) return;
  setState(wasPaused ? "paused" : "idle");
}

// 读取图片原始尺寸，作为坐标系基准。
function resolveImageSize(url: string): Promise<{ width: number; height: number }> {
  const src = url.trim();
  if (!src) return Promise.resolve({ width: 0, height: 0 });
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      });
    };
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

// 加载并归一化 segment 数据模型，构建可渲染运行时状态。
async function loadModels(token: number): Promise<boolean> {
  setState("loading");
  errorText.value = "";
  try {
    const widthFromProp = Number(props.sourceImageWidth);
    const heightFromProp = Number(props.sourceImageHeight);
    const hasWidthFromProp = Number.isFinite(widthFromProp) && widthFromProp > 0;
    const hasHeightFromProp =
      Number.isFinite(heightFromProp) && heightFromProp > 0;

    const imageMeta =
      hasWidthFromProp && hasHeightFromProp
        ? { width: widthFromProp, height: heightFromProp }
        : await resolveImageSize(props.imageUrl);

    const imageWidthBase = hasWidthFromProp ? widthFromProp : imageMeta.width;
    const imageHeightBase = hasHeightFromProp ? heightFromProp : imageMeta.height;

    // 将 OCR/TTS 原始数据归一化为可渲染的运行模型。
    const loaded = await loadSegmentModels(props.segmentAssets, {
      imageWidth: imageWidthBase,
      imageHeight: imageHeightBase,
    });
    if (token !== modelLoadToken) return false;
    imageWidth.value = loaded.imageWidth || imageWidthBase;
    imageHeight.value = loaded.imageHeight || imageHeightBase;
    segments.value = loaded.segments;
    resetAllProgress();
    emitProgressChange();
    setState("idle");
    void nextTick(() => {
      if (displayMode.value === "text") {
        centerInitialTextLine("auto");
      } else {
        centerActiveTextLine("auto", true);
      }
    });
    return true;
  } catch (e) {
    if (token !== modelLoadToken) return false;
    errorText.value = String((e as Error)?.message ?? e);
    setState("error");
    return false;
  }
}

// 等待当前模型加载结束；数据异步传入后立即播放时需要先等 watch 触发的重建完成。
async function waitForModelReady() {
  if (pendingModelLoad) {
    await pendingModelLoad;
  }
  return playerState.value !== "loading" && playerState.value !== "error";
}

// 主题变量：提供给样式层的高亮色与圆角参数。
const themeVars = computed(() => ({
  "--hl-color": props.highlightColor,
  "--hl-soft-color": toSoftColor(props.highlightColor, 0.56),
  "--seg-radius": String(Math.max(0, props.highlightRadius ?? 0)),
}));

// 当前展示模式（image/text），无效值兜底到 image。
const displayMode = computed<DisplayMode>(() =>
  props.displayMode === "text" ? "text" : "image",
);
// 高亮圆角半径（负值保护）。
const highlightRadius = computed(() => Math.max(0, props.highlightRadius ?? 0));
// 实际播放倍速（非法值回退到 1）。
const effectivePlaybackRate = computed(() => {
  const rate = Number(props.playbackRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
});
// 自动跟随恢复延时（毫秒，非法值回退到默认值）。
const effectiveAutoFollowResumeDelay = computed(() => {
  const delay = Number(props.autoFollowResumeDelayMs);
  return Number.isFinite(delay) && delay >= 0 ? delay : 1800;
});

// 浏览器是否支持混合模式（用于高亮叠加效果）。
const supportsBlendMode =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("mix-blend-mode", "multiply");

// 将高亮色转成带透明度的 rgba，供进度背景渐变使用。
function toSoftColor(color: string, alpha: number): string {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt(`${hex[0]}${hex[0]}`, 16);
    const g = Number.parseInt(`${hex[1]}${hex[1]}`, 16);
    const b = Number.parseInt(`${hex[2]}${hex[2]}`, 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }
  const rgbMatch = color.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1]!
      .split(",")
      .slice(0, 3)
      .map((v) => Number.parseFloat(v.trim()));
    if ([r, g, b].every((v) => Number.isFinite(v))) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  return `rgba(242, 180, 174, ${safeAlpha})`;
}

// 记录/移除文本行 DOM 引用，供居中滚动计算使用。
function bindTextLineEl(
  id: string,
  el: Element | { $el?: Element | null } | null,
) {
  const node =
    el instanceof HTMLElement
      ? el
      : el && "$el" in el && el.$el instanceof HTMLElement
        ? el.$el
        : null;

  if (node) {
    textLineEls.set(id, node);
  } else {
    textLineEls.delete(id);
  }
}

const punctPattern = /^[,.;:!?，。！？、）》】\])]+$/;
const latinPattern = /[A-Za-z0-9]/;
const cjkPattern = /[\u3400-\u9FFF]/;

// 估算词在文本模式下的视觉宽度单位（用于把词级时间映射到整行进度）。
function estimateWordUnits(text: string): number {
  const clean = String(text || "");
  if (!clean) return 0.8;
  let units = 0;
  for (const ch of clean) {
    if (cjkPattern.test(ch)) {
      units += 1;
      continue;
    }
    if (latinPattern.test(ch)) {
      units += 0.62;
      continue;
    }
    units += punctPattern.test(ch) ? 0.45 : 0.7;
  }
  return Math.max(0.45, units);
}

// 构建文本行：同时生成展示文案和词级时间锚点，支持“逐词 + 连续”进度。
function buildTextLineModel(
  run: RunModel,
  segment: SegmentModel,
  segmentIndex: number,
  runIndex: number,
): TextLineModel {
  const textParts: string[] = [];
  const wordCues: TextWordProgressCue[] = [];
  let cursorUnits = 0;

  run.words.forEach((word, wordIndex) => {
    const token = String(word.text || "");
    const addLeadingSpace = textParts.length > 0 && !punctPattern.test(token);
    if (addLeadingSpace) {
      textParts.push(` ${token}`);
      cursorUnits += 0.42;
    } else {
      textParts.push(token);
    }

    const startUnit = cursorUnits;
    const endUnit = startUnit + estimateWordUnits(token);
    cursorUnits = endUnit;

    if (typeof word.t0 === "number" && typeof word.t1 === "number" && word.t1 > word.t0) {
      wordCues.push({
        id: `${segment.id}-run-${runIndex + 1}-word-${wordIndex + 1}`,
        t0: word.t0,
        t1: word.t1,
        startUnit,
        endUnit,
      });
    }
  });

  const totalUnits = Math.max(cursorUnits, 1);
  const sortedCues = [...wordCues].sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  const normalizedCues: TextWordProgressCue[] = [];
  let lastEndUnit = 0;
  for (const cue of sortedCues) {
    const startUnit = Math.max(lastEndUnit, Math.min(totalUnits, cue.startUnit));
    const endUnit = Math.max(startUnit, Math.min(totalUnits, cue.endUnit));
    normalizedCues.push({
      ...cue,
      startUnit,
      endUnit,
    });
    lastEndUnit = endUnit;
  }
  const t0 = normalizedCues.length ? normalizedCues[0]!.t0 : segment.t0;
  const t1 = normalizedCues.length ? normalizedCues[normalizedCues.length - 1]!.t1 : segment.t1;

  return {
    id: `${segment.id}-line-${runIndex + 1}`,
    text: textParts.join("").trim(),
    segmentIndex,
    segmentId: segment.id,
    t0,
    t1,
    totalUnits,
    wordCues: normalizedCues,
  };
}

// 文本模式行数据：由分段 runs 动态映射而来。
const textLines = computed<TextLineModel[]>(() =>
  segments.value.flatMap((segment, segmentIndex) =>
    segment.runs.map((run, runIndex) => buildTextLineModel(run, segment, segmentIndex, runIndex)),
  ),
);

// 当前文本模式活跃行索引。
const activeTextLineIndex = computed(() => {
  if (currentSegmentIndex.value < 0) return -1;
  const currentLines = textLines.value;
  if (!currentLines.length) return -1;

  const currentSegmentLines = currentLines.filter(
    (line) => line.segmentIndex === currentSegmentIndex.value,
  );
  if (!currentSegmentLines.length) return -1;

  const tMs = currentTimeMs.value;
  // 文本模式下优先匹配“当前时间命中的行”，否则回退到首行/末行。
  const activeCandidates = currentSegmentLines.filter(
    (line) => tMs >= line.t0 && tMs < line.t1,
  );
  if (activeCandidates.length) {
    const activeLine = activeCandidates.reduce((best, current) =>
      current.t0 > best.t0 ? current : best,
    );
    return currentLines.findIndex((line) => line.id === activeLine.id);
  }

  if (tMs < currentSegmentLines[0]!.t0) {
    return currentLines.findIndex(
      (line) => line.id === currentSegmentLines[0]!.id,
    );
  }
  return currentLines.findIndex(
    (line) =>
      line.id === currentSegmentLines[currentSegmentLines.length - 1]!.id,
  );
});

// 文本模式上下 spacer 样式（用于视觉居中）。
const textSpacerStyle = computed(() => {
  const h = Math.max(0, textStageHeight.value / 2);
  return { height: `${h}px` };
});

// 计算当前激活行的阅读进度（0~1）。
function lineProgress(index: number, line: TextLineModel): number {
  if (activeTextLineIndex.value < 0) return 0;
  if (index !== activeTextLineIndex.value) return 0;
  const tMs = currentTimeMs.value;
  const cues = line.wordCues;

  // 无词级时间戳时，回退为整行线性进度。
  if (!cues.length) {
    const duration = Math.max(1, line.t1 - line.t0);
    return Math.max(0, Math.min(1, (tMs - line.t0) / duration));
  }

  const first = cues[0]!;
  const last = cues[cues.length - 1]!;
  if (tMs <= first.t0) return 0;
  if (tMs >= last.t1) return 1;

  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i]!;
    const prev = i > 0 ? cues[i - 1]! : null;

    // 词间空隙：在“上词结束 -> 下词开始”之间继续平滑推进，避免进度断档。
    if (prev && tMs >= prev.t1 && tMs < cue.t0) {
      const gap = Math.max(1, cue.t0 - prev.t1);
      const ratio = Math.max(0, Math.min(1, (tMs - prev.t1) / gap));
      const unit = prev.endUnit + (cue.startUnit - prev.endUnit) * ratio;
      return Math.max(0, Math.min(1, unit / line.totalUnits));
    }

    // 当前词内：按该词时间窗口线性推进。
    if (tMs >= cue.t0 && tMs < cue.t1) {
      const duration = Math.max(1, cue.t1 - cue.t0);
      const ratio = Math.max(0, Math.min(1, (tMs - cue.t0) / duration));
      const unit = cue.startUnit + (cue.endUnit - cue.startUnit) * ratio;
      return Math.max(0, Math.min(1, unit / line.totalUnits));
    }
  }

  return 1;
}

// 生成文本行样式变量，用于驱动行内背景进度渲染。
function textLineStyle(index: number, line: TextLineModel) {
  return {
    "--seg-progress": `${(lineProgress(index, line) * 100).toFixed(2)}%`,
  };
}

// 判断当前是否允许自动跟随到激活行。
function shouldAutoFollowText() {
  return (
    displayMode.value === "text" &&
    props.autoFollowText &&
    textAutoFollowAllowed.value
  );
}

// 将当前激活行滚动到可视区域垂直中心。
function centerActiveTextLine(
  behavior: ScrollBehavior = "smooth",
  force = false,
) {
  if (!force && !shouldAutoFollowText()) return;
  if (displayMode.value !== "text") return;
  if (activeTextLineIndex.value < 0) return;
  const activeLine = textLines.value[activeTextLineIndex.value];
  if (!activeLine) return;
  centerTextLineById(activeLine.id, behavior);
}

// 将指定行滚动到容器中心。
function centerTextLineById(lineId: string, behavior: ScrollBehavior = "smooth") {
  if (displayMode.value !== "text") return;
  const stage = textStageRef.value;
  if (!stage) return;
  const activeEl = textLineEls.get(lineId);
  if (!activeEl) return;

  const stageRect = stage.getBoundingClientRect();
  const activeRect = activeEl.getBoundingClientRect();
  const targetTop =
    stage.scrollTop +
    (activeRect.top + activeRect.height / 2) -
    (stageRect.top + stageRect.height / 2);
  const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
  const nextTop = Math.max(0, Math.min(targetTop, maxTop));
  const now = Date.now();
  // smooth 会持续触发 scroll，短暂加锁避免误判为用户滚动。
  programmaticScrollLockUntil = now + (behavior === "smooth" ? 620 : 180);
  stage.scrollTo({ top: nextTop, behavior });
}

// 文本模式初始定位：将首句放到目标居中位置，避免开播后先滚一下。
function centerInitialTextLine(behavior: ScrollBehavior = "auto") {
  const lineId = resolveInitialTextLineId();
  if (!lineId) {
    lastCenteredTextLineId = "";
    return;
  }
  centerTextLineById(lineId, behavior);
  lastCenteredTextLineId = lineId;
}

// 同步文本容器高度，供顶部/底部 spacer 计算。
function syncTextStageSize() {
  const stage = textStageRef.value;
  textStageHeight.value = stage?.clientHeight ?? 0;
}

// 为文本容器绑定 resize 监听，容器尺寸变化时重新居中。
function bindTextStageObserver() {
  textStageResizeObserver?.disconnect();
  textStageResizeObserver = null;
  const stage = textStageRef.value;
  if (!stage || typeof ResizeObserver === "undefined") {
    syncTextStageSize();
    return;
  }

  textStageResizeObserver = new ResizeObserver(() => {
    syncTextStageSize();
    centerActiveTextLine("auto");
  });
  textStageResizeObserver.observe(stage);
  syncTextStageSize();
}

// 用户手动滚动后延时恢复自动跟随。
function scheduleAutoFollowResume() {
  window.clearTimeout(textAutoFollowResumeTimer);
  textAutoFollowResumeTimer = window.setTimeout(() => {
    textAutoFollowAllowed.value = true;
    centerActiveTextLine("smooth", true);
  }, effectiveAutoFollowResumeDelay.value);
}

// 处理用户交互：暂时关闭自动跟随，避免与手势抢滚动。
function handleTextStageUserInteraction() {
  if (!props.autoFollowText || displayMode.value !== "text") return;
  textAutoFollowAllowed.value = false;
  scheduleAutoFollowResume();
}

// 处理文本容器滚动事件（忽略程序触发的滚动）。
function handleTextStageScroll() {
  if (Date.now() < programmaticScrollLockUntil) return;
  handleTextStageUserInteraction();
}

// 模式同步：进入文本模式时重置自动跟随状态并立即对齐到当前行。
function syncDisplayMode(force = false) {
  const mode = displayMode.value;
  if (!force && mode === prevDisplayMode) return;
  prevDisplayMode = mode;
  window.clearTimeout(textAutoFollowResumeTimer);
  textAutoFollowAllowed.value = true;
  lastCenteredTextLineId = "";
  programmaticScrollLockUntil = 0;
  if (mode !== "text") return;
  void nextTick(() => {
    if (currentSegmentIndex.value < 0) {
      centerInitialTextLine("auto");
      return;
    }
    centerActiveTextLine("auto", true);
    syncCenteredLineMarker();
  });
}

// 自动跟随开关同步：显式控制是否允许程序滚动文本窗口。
function syncAutoFollow(force = false) {
  const enabled = Boolean(props.autoFollowText);
  if (!force && enabled === prevAutoFollowText) return;
  prevAutoFollowText = enabled;
  if (!enabled) {
    window.clearTimeout(textAutoFollowResumeTimer);
    textAutoFollowAllowed.value = false;
    return;
  }
  textAutoFollowAllowed.value = true;
  centerActiveTextLine("smooth", true);
}

// 文本容器引用同步：DOM 节点变化时重绑 observer，避免监听过期节点。
function syncTextStageObserver(force = false) {
  const stage = textStageRef.value;
  if (!force && stage === observedTextStageEl) return;
  observedTextStageEl = stage;
  bindTextStageObserver();
}

// 倍速同步：仅当外部倍速实际变更时写入 audio，避免重复赋值。
function syncPlaybackRate(force = false) {
  const rate = effectivePlaybackRate.value;
  if (!force && rate === prevPlaybackRate) return;
  prevPlaybackRate = rate;
  applyPlaybackRate(rate);
}

// 数据源同步：segment 或 image 变化时重建模型，数据流入口集中在这里。
function syncSegmentSource() {
  lastCenteredTextLineId = "";
  programmaticScrollLockUntil = 0;
  stopInternal(false);
  modelLoadToken += 1;
  const token = modelLoadToken;
  pendingModelLoad = loadModels(token).finally(() => {
    if (token === modelLoadToken) pendingModelLoad = null;
  });
}

// 明确监听数据源 props，而不是在 onUpdated 中用不完整签名推断变化。
// deep: true 覆盖调用方原地修改 segmentAssets/ocr_tts 字段的场景。
watch(
  () => ({
    imageUrl: props.imageUrl,
    segmentAssets: props.segmentAssets,
    sourceImageWidth: props.sourceImageWidth,
    sourceImageHeight: props.sourceImageHeight,
  }),
  () => {
    syncSegmentSource();
  },
  { deep: true },
);

// 首次挂载：强制跑一轮全量同步，初始化播放器可用状态。
onMounted(() => {
  syncSegmentSource();
  syncPlaybackRate(true);
  syncDisplayMode(true);
  syncAutoFollow(true);
  syncTextStageObserver(true);
  emit("state-change", playerState.value);
});

// 每次组件更新后同步依赖 DOM 更新的副作用；数据源变化由上方 watch 负责。
onUpdated(() => {
  syncPlaybackRate();
  syncDisplayMode();
  syncAutoFollow();
  syncTextStageObserver();
});

// 组件卸载时清理定时器、observer、音频播放流程。
onBeforeUnmount(() => {
  window.clearTimeout(textAutoFollowResumeTimer);
  textStageResizeObserver?.disconnect();
  textStageResizeObserver = null;
  observedTextStageEl = null;
  stopInternal(false);
});

defineExpose<SvgSequencePlayerExpose>({
  playAll,
  playSegment,
  pause,
  resume,
  togglePause,
  stop,
  getState: () => playerState.value,
  getProgress: buildProgressPayload,
  seekToProgress,
  seekSegmentToProgress,
});
</script>

<style scoped>
.root {
  display: grid;
  gap: 10px;
  --hl-color: #f2b4ae;
}

.text-mode-root {
  height: 100%;
  min-height: 0;
}

.status {
  font-size: 12px;
  color: #374151;
}

.err {
  color: #b00020;
}

.stage {
  position: relative;
  width: min(100%, 1100px);
  isolation: isolate;
}

.image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 8px;
}

.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.text-stage {
  width: min(100%, 1100px);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.text-stage::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.text-content {
  min-height: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 0 12px;
  display: grid;
  justify-items: center;
  gap: 22px;
}

.text-spacer {
  width: 1px;
}

.text-segment {
  margin: 0;
  font-size: clamp(24px, 3vw, 42px);
  line-height: 1.35;
  letter-spacing: 0.01em;
  color: #1f2937;
  width: fit-content;
  max-width: 100%;
  text-wrap: pretty;
  text-align: center;
  padding: 0.1em 0.24em;
  border-radius: calc(var(--seg-radius, 0) * 1px);
  background: linear-gradient(
    to right,
    var(--hl-soft-color) 0 var(--seg-progress),
    transparent var(--seg-progress) 100%
  );
  transition:
    background 140ms linear,
    opacity 180ms ease;
}

.text-segment.active {
  opacity: 1;
}

.base {
  fill: var(--hl-color);
  fill-opacity: 0.08;
  stroke: var(--hl-color);
  stroke-opacity: 0.3;
  stroke-width: 1;
}

.base.active {
  stroke: var(--hl-color);
  stroke-opacity: 0.95;
  stroke-width: 2;
}

.fill {
  fill: var(--hl-color);
  fill-opacity: 0.32;
  stroke: none;
}

.blend-supported .fill {
  fill-opacity: 0.6;
  mix-blend-mode: multiply;
}
</style>
