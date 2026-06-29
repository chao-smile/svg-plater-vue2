export type RotatedRect = [number, number, number, number, number];

export type OcrWordRaw = {
  text: string;
  rotated_rect: RotatedRect;
};

export type OcrJson = {
  code: number;
  data: {
    width: number;
    height: number;
    words: OcrWordRaw[];
  };
};

export type TtsToken = {
  text: string;
  begin_time: number;
  end_time: number;
  begin_index?: number;
  end_index?: number;
};

export type TtsJson = {
  header: Record<string, unknown>;
  payload: {
    subtitles: TtsToken[];
  };
};

export type ManifestSegment = {
  id: string;
  image: string;
  audio: string;
  ocr: string;
  tts: string;
  global_time_range_ms: [number, number];
  duration_ms: number;
  word_index_range: [number, number];
  text: string;
};

export type SegmentManifest = {
  dataset: string;
  image: string;
  source: {
    image: string;
    audio: string;
    ocr: string;
    tts: string;
  };
  segment_count: number;
  segments: ManifestSegment[];
};

export type BBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WordModel = {
  id: string;
  text: string;
  idx: number;
  bbox: BBox;
  t0?: number;
  t1?: number;
};

export type TimedWordModel = WordModel & {
  t0: number;
  t1: number;
};

export type RunModel = {
  id: string;
  bbox: BBox;
  expandedBBox: BBox;
  words: WordModel[];
  timedWords: TimedWordModel[];
};

export type SegmentModel = {
  id: string;
  audioUrl: string;
  text: string;
  highlightColor?: string;
  t0: number;
  t1: number;
  runs: RunModel[];
};

export type SegmentOcrTtsWord = {
  text: string;
  rotated_rect: RotatedRect | number[];
  begin_time: number | string;
  end_time: number | string;
};

export type SegmentAsset = {
  id?: string;
  audio_url: string;
  highlightColor?: string;
  ocr_tts: SegmentOcrTtsWord[];
  text: string;
};

export type PlayerState = "loading" | "idle" | "playing" | "paused" | "error";

export type SvgSequencePlayerProgress = {
  segmentIndex: number;
  segmentId: string | null;
  segmentCount: number;
  currentTimeMs: number;
  durationMs: number;
  segmentTimeMs: number;
  segmentDurationMs: number;
  progress: number;
};

export type SvgSequencePlayerExpose = {
  playAll: () => Promise<void>;
  playSegment: (index: number) => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  togglePause: () => void;
  stop: () => void;
  getState: () => PlayerState;
  getProgress: () => SvgSequencePlayerProgress;
  seekToProgress: (progress: number) => Promise<void>;
  seekSegmentToProgress: (index: number, progress: number) => Promise<void>;
};
