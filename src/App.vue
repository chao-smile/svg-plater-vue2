<template>
  <main class="page">
    <header class="header">
      <h1>svg-player</h1>
      <p>
        基于共享图片 <code>test.png</code> + 5 组
        <code>audio/ocr/tts</code> 顺序播放。
      </p>
    </header>

    <section class="panel">
      <div class="line manifest-line">
        <b>Original Manifest:</b>
        <code class="manifest-code" :title="MANIFEST_URL">{{
          MANIFEST_URL
        }}</code>
      </div>
      <div class="line">
        <b>Current Mock:</b> {{ currentDatasetLabel }}
      </div>
      <div class="line">
        <b>Segments:</b> {{ segmentAssets.length }}
      </div>
      <div class="line">
        <b>Used Mock Files:</b> {{ SVG_PLAYER_USED_MOCK_FILES.length }}
      </div>
      <div class="line"><b>View Mode:</b> {{ displayModeText }}</div>
      <div class="line"><b>Player State:</b> {{ playerState }}</div>
      <div class="line">
        <b>Finished Count:</b> {{ finishedCount
        }}<span v-if="finishedAt"> (last: {{ finishedAt }})</span>
      </div>

      <div class="actions">
        <button :disabled="!canPlay" @click="handleMainButton">
          {{ mainButtonText }}
        </button>
        <button :disabled="!canPause" @click="handlePauseButton">
          {{ pauseText }}
        </button>
        <button
          :disabled="!canAdjustRate"
          class="secondary"
          @click="handleSpeedButton"
        >
          {{ speedButtonText }}
        </button>
        <button
          :disabled="!canToggleMode"
          class="secondary"
          @click="handleModeButton"
        >
          {{ modeButtonText }}
        </button>
        <button :disabled="loading" class="secondary" @click="loadManifest">
          重新加载数据
        </button>
      </div>

      <div class="prop-demo">
        <div class="title">Props 更新演示</div>
        <div class="line">
          <b>Image Size:</b> {{ sourceImageWidth }} x {{ sourceImageHeight }}
        </div>
        <div class="line">
          <b>SegmentAssets:</b> {{ currentDatasetLabel }}
        </div>
        <div class="line">
          <b>Async Demo:</b> {{ asyncDemoStatus }}
        </div>
        <div class="actions">
          <button
            :disabled="!canUpdateDemoProps"
            class="secondary"
            @click="handleToggleDemoDataset"
          >
            {{ toggleDatasetButtonText }}
          </button>
          <button
            :disabled="!canUpdateDemoProps"
            class="secondary"
            @click="handleAsyncLoadAndPlayDemo"
          >
            异步加载并立即播放
          </button>
        </div>
      </div>

      <div v-if="segmentAssets.length" class="segment-actions">
        <div
          v-for="(item, index) in segmentAssets"
          :key="item.id == null ? index : item.id"
          class="segment-control"
        >
          <button
            class="segment-play-button"
            :disabled="!canPlaySegment"
            :aria-label="segmentButtonLabel(index)"
            :title="item.text"
            @click="handleSegmentTransportButton(index)"
          >
            <span
              class="transport-icon"
              :class="{ pause: isSegmentPlaying(index) }"
              aria-hidden="true"
            />
            <span>{{ segmentButtonLabel(index) }}</span>
          </button>
          <div class="progress-control">
            <input
              class="progress-range"
              type="range"
              min="0"
              max="1000"
              step="1"
              :value="segmentProgressValue(index)"
              :disabled="!canPlaySegment"
              :aria-valuetext="segmentProgressAriaText(index)"
              :aria-label="`第 ${index + 1} 段音频进度`"
              @pointerdown="handleSegmentScrubStart(index)"
              @pointerup="handleSegmentScrubEnd"
              @pointercancel="handleSegmentScrubCancel"
              @input="handleSegmentProgressInput(index, $event)"
              @change="handleSegmentScrubEnd"
            />
            <div class="progress-meta">
              <span>{{ segmentProgressTimeText(index) }}</span>
              <span class="segment-title">{{ item.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="loading">加载 manifest 中...</div>
      <div v-else-if="errorText" class="error">{{ errorText }}</div>
    </section>

    <section
      class="panel player-panel"
      :class="{ 'text-mode': displayMode === 'text' }"
      v-if="imageUrl"
    >
      <SvgSequencePlayer
        ref="playerRef"
        :image-url="imageUrl"
        :segment-assets="segmentAssets"
        :source-image-width="sourceImageWidth"
        :source-image-height="sourceImageHeight"
        :display-mode="displayMode"
        :playback-rate="playbackRate"
        @finished="onPlayerFinished"
        @state-change="onPlayerStateChange"
        @progress-change="onPlayerProgressChange"
      />
    </section>

    <section class="panel" v-if="imageUrl">
      <div class="title">SvgSequencePlayer Props</div>
      <pre class="props-preview">{{ playerPropsJson }}</pre>
    </section>

    <section class="panel" v-if="segmentRows.length">
      <div class="title">段落清单</div>
      <div v-for="item in segmentRows" :key="item.id" class="segment-row">
        <code>{{ item.id }}</code>
        <span>{{ item.text }}</span>
        <span class="dim">{{ item.durationMs }}ms</span>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { SvgSequencePlayer } from "./components/svg-sequence-player";
import type {
  PlayerState,
  SegmentAsset,
  SvgSequencePlayerExpose,
  SvgSequencePlayerProgress,
} from "./components/svg-sequence-player";
import {
  SVG_PLAYER_DATA_ROOT,
  SVG_PLAYER_IMAGE_HEIGHT,
  SVG_PLAYER_IMAGE_URL,
  SVG_PLAYER_IMAGE_WIDTH,
  SVG_PLAYER_LONG_TEXT_IMAGE_HEIGHT,
  SVG_PLAYER_LONG_TEXT_IMAGE_URL,
  SVG_PLAYER_LONG_TEXT_IMAGE_WIDTH,
  SVG_PLAYER_LONG_TEXT_SEGMENT_ASSETS,
  SVG_PLAYER_MANIFEST_URL,
  SVG_PLAYER_SEGMENT_ASSETS,
  SVG_PLAYER_USED_MOCK_FILES,
} from "./mock/svgPlayerMock";

const MANIFEST_URL = `${SVG_PLAYER_MANIFEST_URL} (from ${SVG_PLAYER_DATA_ROOT})`;
type DemoDataset = "original" | "longText";

// Demo 页面状态：加载、错误、当前传给播放器的数据。
const loading = ref(true);
const errorText = ref("");
const imageUrl = ref("");
const sourceImageWidth = ref(SVG_PLAYER_IMAGE_WIDTH);
const sourceImageHeight = ref(SVG_PLAYER_IMAGE_HEIGHT);
const segmentAssets = ref<SegmentAsset[]>([]);

const playerRef = ref<SvgSequencePlayerExpose | null>(null);

// 仅用于演示控制面板和状态展示，不影响播放器内部逻辑。
const playerState = ref<PlayerState>("loading");
const finishedCount = ref(0);
const finishedAt = ref("");
const currentDataset = ref<DemoDataset>("original");
const asyncDemoStatus = ref("未触发");
let asyncDemoToken = 0;
const playbackRateOptions = [1, 1.25, 1.5, 2] as const;
const playbackRate = ref<number>(playbackRateOptions[0]);
const displayMode = ref<"image" | "text">("image");
const activePlayer = computed(() => playerRef.value);
const progressInfo = ref<SvgSequencePlayerProgress | null>(null);
const segmentProgressValues = ref<Record<number, number>>({});
const scrubbingSegmentIndex = ref<number | null>(null);
const scrubWasPlaying = ref(false);
let lastSeekPromise: Promise<void> | null = null;

function cloneSegmentAssets(assets: SegmentAsset[]): SegmentAsset[] {
  return assets.map((asset) => ({
    ...asset,
    ocr_tts: asset.ocr_tts.map((word) => ({
      ...word,
      rotated_rect: Array.isArray(word.rotated_rect)
        ? [...word.rotated_rect]
        : word.rotated_rect,
    })),
  }));
}

function applyDemoDataset(dataset: DemoDataset) {
  activePlayer.value?.stop();
  finishedAt.value = "";
  asyncDemoStatus.value = "未触发";
  progressInfo.value = null;
  segmentProgressValues.value = {};
  scrubbingSegmentIndex.value = null;
  scrubWasPlaying.value = false;
  currentDataset.value = dataset;

  if (dataset === "longText") {
    imageUrl.value = SVG_PLAYER_LONG_TEXT_IMAGE_URL;
    sourceImageWidth.value = SVG_PLAYER_LONG_TEXT_IMAGE_WIDTH;
    sourceImageHeight.value = SVG_PLAYER_LONG_TEXT_IMAGE_HEIGHT;
    segmentAssets.value = cloneSegmentAssets(SVG_PLAYER_LONG_TEXT_SEGMENT_ASSETS);
    return;
  }

  imageUrl.value = SVG_PLAYER_IMAGE_URL;
  sourceImageWidth.value = SVG_PLAYER_IMAGE_WIDTH;
  sourceImageHeight.value = SVG_PLAYER_IMAGE_HEIGHT;
  segmentAssets.value = cloneSegmentAssets(SVG_PLAYER_SEGMENT_ASSETS);
}

async function loadManifest() {
  loading.value = true;
  errorText.value = "";
  try {
    applyDemoDataset("original");
  } catch (e) {
    errorText.value = String((e as Error)?.message ?? e);
  } finally {
    loading.value = false;
  }
}

// “开始/停止”按钮：空闲时播放全部，播放中则停止。
async function handleMainButton() {
  const player = activePlayer.value;
  if (!player) return;

  const state = playerState.value;
  if (state === "idle") {
    finishedAt.value = "";
    await player.playAll();
    return;
  }

  if (state === "playing" || state === "paused") {
    player.stop();
  }
}

function handlePauseButton() {
  activePlayer.value?.togglePause();
}

function handleSpeedButton() {
  const currentIndex = playbackRateOptions.findIndex(
    (rate) => rate === playbackRate.value,
  );
  const nextIndex =
    currentIndex >= 0 ? (currentIndex + 1) % playbackRateOptions.length : 0;
  playbackRate.value = playbackRateOptions[nextIndex]!;
}

function handleModeButton() {
  displayMode.value = displayMode.value === "image" ? "text" : "image";
}

function handleToggleDemoDataset() {
  applyDemoDataset(currentDataset.value === "original" ? "longText" : "original");
}

async function handleAsyncLoadAndPlayDemo() {
  asyncDemoToken += 1;
  const token = asyncDemoToken;
  activePlayer.value?.stop();
  finishedAt.value = "";
  progressInfo.value = null;
  segmentProgressValues.value = {};
  scrubbingSegmentIndex.value = null;
  scrubWasPlaying.value = false;
  currentDataset.value = "longText";
  imageUrl.value = SVG_PLAYER_LONG_TEXT_IMAGE_URL;
  sourceImageWidth.value = SVG_PLAYER_LONG_TEXT_IMAGE_WIDTH;
  sourceImageHeight.value = SVG_PLAYER_LONG_TEXT_IMAGE_HEIGHT;
  segmentAssets.value = [];
  asyncDemoStatus.value = "已清空 segmentAssets，模拟异步请求中";

  await new Promise((resolve) => window.setTimeout(resolve, 800));
  if (token !== asyncDemoToken) return;

  segmentAssets.value = cloneSegmentAssets(SVG_PLAYER_LONG_TEXT_SEGMENT_ASSETS);
  asyncDemoStatus.value = "数据已写入，立即调用 playSegment(0)";
  await nextTick();
  await activePlayer.value?.playSegment(0);

  if (token !== asyncDemoToken) return;
  asyncDemoStatus.value = "playSegment(0) 调用完成";
}

function isSegmentActive(index: number) {
  return progressInfo.value?.segmentIndex === index;
}

function isSegmentPlaying(index: number) {
  return isSegmentActive(index) && playerState.value === "playing";
}

function segmentProgressValue(index: number) {
  return segmentProgressValues.value[index] ?? 0;
}

function setSegmentProgressValue(index: number, value: number) {
  segmentProgressValues.value = {
    ...segmentProgressValues.value,
    [index]: Math.max(0, Math.min(1000, value)),
  };
}

async function handleSegmentTransportButton(index: number) {
  const player = activePlayer.value;
  if (!player) return;

  if (isSegmentActive(index) && playerState.value === "playing") {
    player.pause();
    return;
  }

  if (isSegmentActive(index) && playerState.value === "paused") {
    await player.resume();
    return;
  }

  const progress = segmentProgressValue(index);
  if (progress > 0 && progress < 1000) {
    await player.seekSegmentToProgress(index, progress / 1000);
    await player.resume();
    return;
  }

  if (progress >= 1000) setSegmentProgressValue(index, 0);
  finishedAt.value = "";
  await player.playSegment(index);
}

function handleSegmentScrubStart(index: number) {
  if (!canPlaySegment.value) return;
  scrubbingSegmentIndex.value = index;
  scrubWasPlaying.value = isSegmentActive(index) && playerState.value === "playing";
  if (scrubWasPlaying.value) activePlayer.value?.pause();
}

function handleSegmentProgressInput(index: number, event: Event) {
  const input = event.target as HTMLInputElement | null;
  const value = Number(input?.value ?? 0);
  setSegmentProgressValue(index, value);
  lastSeekPromise =
    activePlayer.value?.seekSegmentToProgress(index, segmentProgressValue(index) / 1000) ??
    null;
}

async function handleSegmentScrubEnd() {
  if (scrubbingSegmentIndex.value == null) return;
  scrubbingSegmentIndex.value = null;
  await lastSeekPromise;
  if (scrubWasPlaying.value) {
    await activePlayer.value?.resume();
  }
  scrubWasPlaying.value = false;
}

function handleSegmentScrubCancel() {
  scrubbingSegmentIndex.value = null;
  scrubWasPlaying.value = false;
}

// 由组件抛出的事件回填到 demo 状态栏。
function onPlayerFinished() {
  finishedCount.value += 1;
  finishedAt.value = new Date().toLocaleTimeString();
}

function onPlayerStateChange(state: PlayerState) {
  console.log("Player state changed:", state);
  playerState.value = state;
}

function onPlayerProgressChange(progress: SvgSequencePlayerProgress) {
  progressInfo.value = progress;
  if (
    progress.segmentIndex >= 0 &&
    scrubbingSegmentIndex.value !== progress.segmentIndex
  ) {
    const segmentProgress =
      progress.segmentDurationMs > 0
        ? progress.segmentTimeMs / progress.segmentDurationMs
        : 0;
    setSegmentProgressValue(progress.segmentIndex, Math.round(segmentProgress * 1000));
  }
}

function formatMs(ms: number) {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const mainButtonText = computed(() => {
  if (playerState.value === "playing" || playerState.value === "paused")
    return "停止播放";
  return `开始顺序播放 ${segmentAssets.value.length} 段`;
});

const canPlay = computed(
  () =>
    !loading.value &&
    !errorText.value &&
    segmentAssets.value.length > 0 &&
    (playerState.value === "idle" ||
      playerState.value === "playing" ||
      playerState.value === "paused"),
);
const canPause = computed(
  () => playerState.value === "playing" || playerState.value === "paused",
);
const canAdjustRate = computed(
  () => !loading.value && !errorText.value && segmentAssets.value.length > 0,
);
const canToggleMode = computed(
  () => !loading.value && !errorText.value && segmentAssets.value.length > 0,
);
const canUpdateDemoProps = computed(() => !loading.value && !errorText.value);
const canPlaySegment = computed(
  () =>
    !loading.value &&
    !errorText.value &&
    segmentAssets.value.length > 0 &&
    playerState.value !== "loading" &&
    playerState.value !== "error",
);
const pauseText = computed(() =>
  playerState.value === "paused" ? "继续" : "暂停",
);
const speedButtonText = computed(() => `倍速 ${playbackRate.value}x`);
const modeButtonText = computed(() =>
  displayMode.value === "image" ? "切换纯文字" : "切换图文",
);
const displayModeText = computed(() =>
  displayMode.value === "image" ? "图文播放" : "纯文字播放",
);
const currentDatasetLabel = computed(() =>
  currentDataset.value === "original" ? "原有 mock 数据" : "长文本 mock 数据",
);
const toggleDatasetButtonText = computed(() =>
  currentDataset.value === "original"
    ? "切换到长文本 mock"
    : "切换到原有 mock",
);
function segmentButtonLabel(index: number) {
  if (isSegmentActive(index) && playerState.value === "playing")
    return `暂停第 ${index + 1} 段`;
  return `播放第 ${index + 1} 段`;
}

function segmentDurationMs(index: number) {
  return segmentRows.value[index]?.durationMs ?? 0;
}

function segmentProgressTimeText(index: number) {
  const duration = segmentDurationMs(index);
  const current = duration * (segmentProgressValue(index) / 1000);
  return `${formatMs(current)} / ${formatMs(duration)}`;
}

function segmentProgressAriaText(index: number) {
  const percent = Math.round(segmentProgressValue(index) / 10);
  return `第 ${index + 1} 段，${segmentProgressTimeText(index)}，${percent}%`;
}
const playerPropsData = computed(() => ({
  imageUrl: imageUrl.value,
  segmentAssets: segmentAssets.value,
  sourceImageWidth: sourceImageWidth.value,
  sourceImageHeight: sourceImageHeight.value,
  displayMode: displayMode.value,
  playbackRate: playbackRate.value,
}));
const playerPropsJson = computed(() =>
  JSON.stringify(playerPropsData.value, null, 2),
);
const segmentRows = computed(() =>
  segmentAssets.value.map((segment, index) => {
    const times = segment.ocr_tts.flatMap((word) => [
      Number(word.begin_time),
      Number(word.end_time),
    ]).filter((time) => Number.isFinite(time));
    const durationMs = times.length
      ? Math.max(...times) - Math.min(...times)
      : 0;
    return {
      id: segment.id ?? `segment-${index + 1}`,
      text: segment.text,
      durationMs,
    };
  }),
);

// 首次进入页面加载 mock 数据，并同步一次组件状态。
onMounted(async () => {
  await loadManifest();
  await nextTick();
  playerState.value = activePlayer.value?.getState() ?? "idle";
});
</script>

<style scoped>
.page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px;
  display: grid;
  gap: 14px;
}

.header h1 {
  margin: 0;
  font-size: 28px;
}

.header p {
  margin: 8px 0 0;
  color: #4b5563;
}

.panel {
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  display: grid;
  gap: 10px;
}

.player-panel {
  min-height: 260px;
}

.player-panel.text-mode {
  height: clamp(360px, 72vh, 760px);
  min-height: 0;
}

.player-panel.text-mode ::v-deep .root {
  height: 100%;
  min-height: 0;
}

.line {
  font-size: 13px;
}

.manifest-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.manifest-code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.segment-actions {
  display: grid;
  gap: 10px;
}

.segment-control {
  display: grid;
  grid-template-columns: minmax(138px, auto) minmax(240px, 1fr);
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #dbe3ee;
  border-radius: 8px;
  background: #f8fafc;
}

.segment-play-button {
  min-height: 44px;
  min-width: 138px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 700;
  background: #111827;
  color: #ffffff;
  border-color: #111827;
}

.segment-play-button:disabled {
  background: #9ca3af;
  border-color: #9ca3af;
}

.transport-icon {
  position: relative;
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
}

.transport-icon::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 1px;
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-left: 9px solid currentColor;
}

.transport-icon.pause::before,
.transport-icon.pause::after {
  content: "";
  position: absolute;
  top: 1px;
  width: 4px;
  height: 12px;
  border: 0;
  background: currentColor;
}

.transport-icon.pause::before {
  left: 2px;
}

.transport-icon.pause::after {
  right: 2px;
}

.progress-control {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.progress-range {
  width: 100%;
  min-height: 32px;
  margin: 0;
  cursor: pointer;
  accent-color: #2563eb;
}

.progress-range:disabled {
  cursor: not-allowed;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: #4b5563;
  font-size: 12px;
}

.segment-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.prop-demo {
  border-top: 1px solid #e5e7eb;
  padding-top: 10px;
  display: grid;
  gap: 8px;
}

button {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #f9fafb;
  color: #111827;
  padding: 8px 12px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.secondary {
  background: #ffffff;
}

.error {
  color: #b00020;
}

.title {
  font-weight: 700;
  font-size: 14px;
}

.segment-row {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}

.props-preview {
  margin: 0;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow: auto;
  max-height: 360px;
}

.dim {
  color: #6b7280;
}

@media (max-width: 768px) {
  .page {
    padding: 14px;
  }

  .header h1 {
    font-size: 24px;
  }

  .segment-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .segment-control {
    grid-template-columns: 1fr;
  }

  .segment-play-button {
    width: 100%;
  }
}
</style>
