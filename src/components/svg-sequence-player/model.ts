import type {
  BBox,
  RunModel,
  SegmentAsset,
  SegmentOcrTtsWord,
  SegmentModel,
  TimedWordModel,
  WordModel,
} from "./types";

// 计算一组词包围盒并集，得到整行矩形区域。
function unionBBox(words: WordModel[]): BBox {
  const x0 = Math.min(...words.map((w) => w.bbox.x));
  const y0 = Math.min(...words.map((w) => w.bbox.y));
  const x1 = Math.max(...words.map((w) => w.bbox.x + w.bbox.w));
  const y1 = Math.max(...words.map((w) => w.bbox.y + w.bbox.h));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function averageWordHeight(words: WordModel[]): number {
  return words.reduce((sum, word) => sum + word.bbox.h, 0) / Math.max(1, words.length);
}

// 计算图片模式的行效果框：宽度沿用整行并集，高度使用当前段全部词高平均值。
function averageHeightBBox(words: WordModel[], height: number): BBox {
  const union = unionBBox(words);
  const centerY = union.y + union.h / 2;
  const safeHeight = Math.max(1, height);

  return {
    x: union.x,
    y: centerY - safeHeight / 2,
    w: union.w,
    h: safeHeight,
  };
}

// 对行矩形做适度扩展，避免高亮视觉过于贴边。
export function expandBox(box: BBox): BBox {
  const padX = Math.max(1, Math.round(box.h * 0.06));
  const topExpand = Math.max(1, Math.round(box.h * 0.1));
  const bottomExpand = Math.max(2, Math.round(box.h * 0.18));
  return {
    x: box.x - padX,
    y: box.y - topExpand,
    w: Math.max(1, box.w + padX * 2),
    h: Math.max(1, box.h + topExpand + bottomExpand),
  };
}

function horizontalGap(a: BBox, b: BBox): number {
  const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return overlap >= 0 ? 0 : Math.abs(overlap);
}

// 分行算法可能因 OCR 基线轻微倾斜把同一行拆成多个 run。
// 垂直中心足够接近、且水平间隙不超过正常词间距的 run 可以重新合并。
function mergeOverlappingRuns(lines: WordModel[][], height: number): WordModel[][] {
  const safeHeight = Math.max(1, height);
  const verticalCenterTolerance = Math.max(2, safeHeight * 0.5);
  const horizontalGapTolerance = safeHeight * 0.75;
  const effectBox = (line: WordModel[]) => expandBox(averageHeightBBox(line, safeHeight));
  const centerY = (box: BBox) => box.y + box.h / 2;
  const merged: WordModel[][] = [];

  for (const line of lines) {
    let current = [...line].sort((a, b) => a.bbox.x - b.bbox.x);
    let matchIndex = -1;

    do {
      const currentBox = effectBox(current);
      matchIndex = merged.findIndex((candidate) => {
        const candidateBox = effectBox(candidate);
        return (
          Math.abs(centerY(currentBox) - centerY(candidateBox)) <=
            verticalCenterTolerance &&
          horizontalGap(currentBox, candidateBox) <= horizontalGapTolerance
        );
      });

      if (matchIndex >= 0) {
        current = [...merged[matchIndex]!, ...current].sort(
          (a, b) => a.bbox.x - b.bbox.x,
        );
        merged.splice(matchIndex, 1);
      }
    } while (matchIndex >= 0);

    merged.push(current);
  }

  merged.sort((a, b) => {
    const boxA = effectBox(a);
    const boxB = effectBox(b);
    return boxA.y - boxB.y || boxA.x - boxB.x;
  });
  return merged;
}

function hasReadableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

// segment 数据已经按分栏拆分；这里只在当前 segment 内先按 y 轴近邻分行，
// 再在每一行按 x 从左到右排序。避免高低略有差异的窄标点先参与基线拟合，
// 将本来同一行的正文拆成多个 run。
function clusterRuns(words: WordModel[]): WordModel[][] {
  const minLineBaselineTolerance = 8;

  const centerY = (word: WordModel) => word.bbox.y + word.bbox.h / 2;
  const sortedByY = [...words].sort(
    (a, b) => centerY(a) - centerY(b) || a.bbox.x - b.bbox.x,
  );
  const lines: WordModel[][] = [];

  for (const word of sortedByY) {
    const cy = centerY(word);
    let bestLine: WordModel[] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const line of lines) {
      const lineCenterY = line.reduce((sum, item) => sum + centerY(item), 0) / line.length;
      const maxHeight = Math.max(word.bbox.h, ...line.map((item) => item.bbox.h));
      const tolerance = Math.max(minLineBaselineTolerance, maxHeight * 0.6);
      const distance = Math.abs(cy - lineCenterY);
      if (distance <= tolerance && distance < bestDistance) {
        bestLine = line;
        bestDistance = distance;
      }
    }

    if (bestLine) bestLine.push(word);
    else lines.push([word]);
  }

  for (const line of lines) line.sort((a, b) => a.bbox.x - b.bbox.x);
  lines.sort((a, b) => {
    const centerA = a.reduce((sum, word) => sum + centerY(word), 0) / a.length;
    const centerB = b.reduce((sum, word) => sum + centerY(word), 0) / b.length;
    return centerA - centerB || a[0]!.bbox.x - b[0]!.bbox.x;
  });
  return lines;
}

// 将 unknown 安全转换为有限数字，失败时回退 fallback。
function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// 读取 OCR 词框 rotated_rect，统一返回 [x, y, w, h]。
function parseWordRect(word: SegmentOcrTtsWord): [number, number, number, number] {
  if (Array.isArray(word.rotated_rect) && word.rotated_rect.length >= 4) {
    const x = toFiniteNumber(word.rotated_rect[0], 0);
    const y = toFiniteNumber(word.rotated_rect[1], 0);
    const w = Math.max(1, toFiniteNumber(word.rotated_rect[2], 1));
    const h = Math.max(1, toFiniteNumber(word.rotated_rect[3], 1));
    return [x, y, w, h];
  }
  return [0, 0, 1, 1];
}

// 把输入 ocr_tts 列表映射为内部词模型（含可选时间戳）。
function buildWords(alignedWords: SegmentOcrTtsWord[]): WordModel[] {
  return alignedWords.map((word, idx) => {
    const [x, y, w, h] = parseWordRect(word);
    const t0 = toFiniteNumber(word.begin_time, NaN);
    const t1 = toFiniteNumber(word.end_time, NaN);
    return {
      id: `word-${idx}`,
      idx,
      text: word.text ?? "",
      // OCR rotated_rect is center-based.
      bbox: { x: x - w / 2, y: y - h / 2, w, h },
      t0: Number.isFinite(t0) ? t0 : undefined,
      t1: Number.isFinite(t1) ? t1 : undefined,
    };
  });
}

// 当缺少外部尺寸时，根据词框推导最小可用画布大小。
function inferImageSize(words: WordModel[]): { width: number; height: number } {
  const right = Math.max(...words.map((w) => w.bbox.x + w.bbox.w), 1);
  const bottom = Math.max(...words.map((w) => w.bbox.y + w.bbox.h), 1);
  return {
    width: Math.max(1, Math.ceil(right + 2)),
    height: Math.max(1, Math.ceil(bottom + 2)),
  };
}

// 校验并标准化单个 segment 资源结构。
function normalizeSegmentAsset(asset: SegmentAsset, index: number) {
  if (!asset || typeof asset !== "object") {
    throw new Error(`segmentAssets[${index}] is invalid`);
  }
  if (!Array.isArray(asset.ocr_tts) || asset.ocr_tts.length === 0) {
    throw new Error(`segmentAssets[${index}].ocr_tts is invalid`);
  }
  const audioUrl = String(asset.audio_url ?? "").trim();
  if (!audioUrl) {
    throw new Error(`segmentAssets[${index}].audio_url is empty`);
  }
  return {
    id: String(asset.id ?? `segment-${index + 1}`),
    audioUrl,
    highlightColor:
      typeof asset.highlightColor === "string" && asset.highlightColor.trim()
        ? asset.highlightColor.trim()
        : undefined,
    text: String(asset.text ?? ""),
    ocrTts: asset.ocr_tts,
  };
}

// 计算一段词的整体时间范围（毫秒）。
function timeRange(words: WordModel[]) {
  const timed = words.filter(
    (w): w is TimedWordModel =>
      typeof w.t0 === "number" && typeof w.t1 === "number",
  );
  if (!timed.length) return { t0: 0, t1: 0 };
  return {
    t0: Math.min(...timed.map((w) => w.t0)),
    t1: Math.max(...timed.map((w) => w.t1)),
  };
}

// 解析并归一化所有 segmentAssets，构建播放器运行时模型。
export async function loadSegmentModels(
  segmentAssets: SegmentAsset[],
  options?: { imageWidth?: number; imageHeight?: number },
): Promise<{ imageWidth: number; imageHeight: number; segments: SegmentModel[] }> {
  let imageWidth = Math.max(0, toFiniteNumber(options?.imageWidth, 0));
  let imageHeight = Math.max(0, toFiniteNumber(options?.imageHeight, 0));

  const loaded = segmentAssets.map((asset, index) => {
    const normalized = normalizeSegmentAsset(asset, index);
    const words = buildWords(normalized.ocrTts);
    const inferred = inferImageSize(words);
    const segmentAverageHeight = averageWordHeight(words);
    const mergedLines = mergeOverlappingRuns(
      clusterRuns(words),
      segmentAverageHeight,
    );

    const runs: RunModel[] = mergedLines.map((line, i) => {
      const bbox = averageHeightBBox(line, segmentAverageHeight);
      const timedWords = line
        .filter(
          (word): word is TimedWordModel =>
            typeof word.t0 === "number" &&
            typeof word.t1 === "number" &&
            hasReadableText(word.text),
        )
        .sort((a, b) => a.t0 - b.t0);
      return {
        id: `${normalized.id}-run-${i + 1}`,
        bbox,
        expandedBBox: expandBox(bbox),
        words: line,
        timedWords,
      };
    });

    const range = timeRange(words);
    const segment: SegmentModel = {
      id: normalized.id,
      audioUrl: normalized.audioUrl,
      text: normalized.text,
      highlightColor: normalized.highlightColor,
      t0: range.t0,
      t1: range.t1,
      runs,
    };

    if (imageWidth <= 0) imageWidth = Math.max(imageWidth, inferred.width);
    if (imageHeight <= 0) imageHeight = Math.max(imageHeight, inferred.height);
    return segment;
  });

  return {
    imageWidth,
    imageHeight,
    segments: loaded,
  };
}

// 计算某个 run 在时刻 tMs 的高亮填充进度（0~1）。
export function computeRunProgress(run: RunModel, tMs: number): number {
  const timed = run.timedWords;

  if (!timed.length) return 0;
  if (tMs <= timed[0]!.t0) return 0;
  if (tMs >= timed[timed.length - 1]!.t1) return 1;

  let xFill = run.bbox.x;
  for (let i = 0; i < timed.length; i++) {
    const cur = timed[i]!;
    const next = timed[i + 1];
    const right = cur.bbox.x + cur.bbox.w;

    if (tMs >= cur.t1) {
      xFill = Math.max(xFill, right);
      continue;
    }

    if (tMs >= cur.t0 && tMs < cur.t1) {
      const ratio = Math.max(0, Math.min(1, (tMs - cur.t0) / Math.max(1, cur.t1 - cur.t0)));
      xFill = Math.max(xFill, cur.bbox.x + cur.bbox.w * ratio);
      break;
    }

    if (next && tMs >= cur.t1 && tMs < next.t0) {
      const ratio = Math.max(0, Math.min(1, (tMs - cur.t1) / Math.max(1, next.t0 - cur.t1)));
      const xGap = right + (next.bbox.x - right) * ratio;
      xFill = Math.max(xFill, xGap);
      break;
    }
  }

  return Math.max(0, Math.min(1, (xFill - run.bbox.x) / Math.max(1, run.bbox.w)));
}
