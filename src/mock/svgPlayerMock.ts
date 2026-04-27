import type {
  OcrJson,
  SegmentAsset,
  SegmentManifest,
  TtsJson,
} from "../components/svg-sequence-player";
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

// SegmentAsset 是组件真正消费的数据结构：音频 URL + ocr_tts 单词时序数组。
export const SVG_PLAYER_SEGMENT_ASSETS: SegmentAsset[] = SVG_PLAYER_MANIFEST.segments.map((segment) => ({
  id: segment.id,
  text: segment.text,
  audio_url: toMockUrl(segment.audio),
  ocr_tts: mergeOcrTts(
    readMockJson(ocrModules, segment.ocr, "ocr"),
    readMockJson(ttsModules, segment.tts, "tts"),
  ),
}));

export const SVG_PLAYER_LONG_TEXT_SEGMENT_ASSETS: SegmentAsset[] = (
  longTextSegmentAssetsJson as SegmentAsset[]
).map((asset) => ({
  ...asset,
  // Demo 页面可能部署在 HTTPS 下，统一把远程音频升级成 HTTPS，避免混合内容拦截。
  audio_url: String(asset.audio_url ?? "").replace(/^http:\/\//, "https://"),
}));

export const SVG_PLAYER_USED_MOCK_FILES = [
  SVG_PLAYER_MANIFEST.image,
  ...SVG_PLAYER_MANIFEST.segments.flatMap((segment) => [segment.audio, segment.ocr, segment.tts]),
  "long-text.segment-assets.json",
];
