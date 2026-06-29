import type {
  OcrJson,
  SegmentAsset,
  SegmentManifest,
  TtsJson,
} from "../components/svg-sequence-player";
import kintsugiLongTextResourceJson from "./svg-player/kintsugi-long-text.resource.json";
import longTextSegmentAssetsJson from "./svg-player/long-text.segment-assets.json";
import manifestJson from "./svg-player/manifest.json";

// 演示数据的单一入口：manifest 描述分段，具体资源来自同目录 mock 文件。
const manifest = manifestJson as SegmentManifest;

const toMockUrl = (file: string) => new URL(`./svg-player/${file}`, import.meta.url).href;
// 预加载 OCR/TTS JSON，避免组件运行时再做 URL 拉取。
const ocrModules = import.meta.glob<OcrJson>("./svg-player/*.ocr.json", {
  eager: true,
  import: "default",
});
const ttsModules = import.meta.glob<TtsJson>("./svg-player/*.tts.json", {
  eager: true,
  import: "default",
});

function readMockJson<T>(modules: Record<string, T>, file: string, type: "ocr" | "tts"): T {
  const key = `./svg-player/${file}`;
  const data = modules[key];
  if (!data) {
    throw new Error(`mock ${type} file not found: ${key}`);
  }
  return data;
}

function mergeOcrTts(ocr: OcrJson, tts: TtsJson): SegmentAsset["ocr_tts"] {
  const subtitles = tts.payload?.subtitles ?? [];
  return ocr.data.words.map((word, index) => {
    const token = subtitles[index];
    const begin = Number(token?.begin_time ?? 0);
    const end = Number(token?.end_time ?? begin);
    return {
      text: String(word.text ?? token?.text ?? ""),
      rotated_rect: word.rotated_rect,
      begin_time: begin,
      end_time: end,
    };
  });
}

type ResourceMockWord = {
  text?: string;
  rotated_rect?: number[];
  begin_time?: number | string | null;
  end_time?: number | string | null;
};

type ResourceMock = {
  image_url?: string;
  width?: number;
  height?: number;
  resource_list?: Array<{
    text?: string;
    audio_url?: string;
    ocr_tts?: ResourceMockWord[];
  }>;
};

const KINTSUGI_LONG_TEXT_FALLBACK_DURATIONS_MS = [23576];
const DEMO_SEGMENT_HIGHLIGHT_COLORS = [
  "#f2b4ae",
  "#b9d8ff",
  "#f8d477",
  "#bfe7c4",
  "#d9c2ff",
];

function getDemoSegmentHighlightColor(index: number): string {
  return DEMO_SEGMENT_HIGHLIGHT_COLORS[index % DEMO_SEGMENT_HIGHLIGHT_COLORS.length]!;
}

function normalizeRemoteUrl(url: unknown): string {
  return String(url ?? "").replace(/^http:\/\//, "https://");
}

function toFiniteTime(value: unknown): number | null {
  const time = Number(value);
  return Number.isFinite(time) ? time : null;
}

function fallbackDurationMs(words: ResourceMockWord[], index: number): number {
  return Math.max(1000, KINTSUGI_LONG_TEXT_FALLBACK_DURATIONS_MS[index] ?? words.length * 340);
}

function normalizeResourceWords(
  words: ResourceMockWord[],
  index: number,
): SegmentAsset["ocr_tts"] {
  const hasTimedWords = words.some(
    (word) => toFiniteTime(word.begin_time) != null && toFiniteTime(word.end_time) != null,
  );
  const durationMs = hasTimedWords ? 0 : fallbackDurationMs(words, index);
  const unitMs = words.length > 0 ? durationMs / words.length : 0;

  return words.map((word, wordIndex) => {
    const begin = toFiniteTime(word.begin_time);
    const end = toFiniteTime(word.end_time);
    return {
      text: String(word.text ?? ""),
      rotated_rect: Array.isArray(word.rotated_rect)
        ? word.rotated_rect
        : [0, 0, 1, 1, 0],
      begin_time: begin ?? Math.round(wordIndex * unitMs),
      end_time: end ?? Math.round((wordIndex + 1) * unitMs),
    };
  });
}

export const SVG_PLAYER_DATA_ROOT = "src/mock/svg-player";

export const SVG_PLAYER_MANIFEST: SegmentManifest = manifest;

export const SVG_PLAYER_MANIFEST_URL = toMockUrl("manifest.json");
export const SVG_PLAYER_IMAGE_URL = toMockUrl(SVG_PLAYER_MANIFEST.image);
export const SVG_PLAYER_IMAGE_WIDTH = 1235;
export const SVG_PLAYER_IMAGE_HEIGHT = 774;

export const SVG_PLAYER_LONG_TEXT_IMAGE_URL =
  "https://vanthink-dev.oss-cn-qingdao.aliyuncs.com/19e4f2a313300a1abceb0def2ba942dd.png";
export const SVG_PLAYER_LONG_TEXT_IMAGE_WIDTH = 1233;
export const SVG_PLAYER_LONG_TEXT_IMAGE_HEIGHT = 779;

const kintsugiLongTextResource = kintsugiLongTextResourceJson as ResourceMock;

export const SVG_PLAYER_KINTSUGI_LONG_TEXT_IMAGE_URL = normalizeRemoteUrl(
  kintsugiLongTextResource.image_url,
);
export const SVG_PLAYER_KINTSUGI_LONG_TEXT_IMAGE_WIDTH =
  Number(kintsugiLongTextResource.width) || 1197;
export const SVG_PLAYER_KINTSUGI_LONG_TEXT_IMAGE_HEIGHT =
  Number(kintsugiLongTextResource.height) || 864;

// SegmentAsset 是组件真正消费的数据结构：音频 URL + ocr_tts 单词时序数组。
export const SVG_PLAYER_SEGMENT_ASSETS: SegmentAsset[] =
  SVG_PLAYER_MANIFEST.segments.map((segment, index) => ({
    id: segment.id,
    text: segment.text,
    audio_url: toMockUrl(segment.audio),
    highlightColor: getDemoSegmentHighlightColor(index),
    ocr_tts: mergeOcrTts(
      readMockJson(ocrModules, segment.ocr, "ocr"),
      readMockJson(ttsModules, segment.tts, "tts"),
    ),
  }));

export const SVG_PLAYER_LONG_TEXT_SEGMENT_ASSETS: SegmentAsset[] = (
  longTextSegmentAssetsJson as SegmentAsset[]
).map((asset) => ({
  ...asset,
  highlightColor: asset.highlightColor ?? "#b9d8ff",
  // Demo 页面可能部署在 HTTPS 下，统一把远程音频升级成 HTTPS，避免混合内容拦截。
  audio_url: normalizeRemoteUrl(asset.audio_url),
}));

export const SVG_PLAYER_KINTSUGI_LONG_TEXT_SEGMENT_ASSETS: SegmentAsset[] = (
  kintsugiLongTextResource.resource_list ?? []
).map((resource, index) => ({
  id: `kintsugi-long-text-${index + 1}`,
  text: String(resource.text ?? `Kintsugi long text ${index + 1}`),
  audio_url: normalizeRemoteUrl(resource.audio_url),
  highlightColor: getDemoSegmentHighlightColor(index),
  ocr_tts: normalizeResourceWords(resource.ocr_tts ?? [], index),
}));

export const SVG_PLAYER_USED_MOCK_FILES = [
  SVG_PLAYER_MANIFEST.image,
  ...SVG_PLAYER_MANIFEST.segments.flatMap((segment) => [segment.audio, segment.ocr, segment.tts]),
  "long-text.segment-assets.json",
  "kintsugi-long-text.resource.json",
];
