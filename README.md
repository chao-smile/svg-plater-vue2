# svg-player

`SvgSequencePlayer` 是一个基于 Vue 2.7.14 的顺序播放组件，用来在一张共享底图上，按照音频时间轴逐段高亮 OCR 文本区域；也支持切换到纯文字滚动播放模式。

组件源码位于 [src/components/svg-sequence-player/index.vue](/Users/pincoudeduanyin/Desktop/demo/ocr/svg-plater-vue2/src/components/svg-sequence-player/index.vue)，当前 demo 用法可参考 [src/App.vue](/Users/pincoudeduanyin/Desktop/demo/ocr/svg-plater-vue2/src/App.vue) 和 [src/mock/svgPlayerMock.ts](/Users/pincoudeduanyin/Desktop/demo/ocr/svg-plater-vue2/src/mock/svgPlayerMock.ts)。

## 启动项目

```bash
npm install
npm run dev
```

## 组件用途

适合这类场景：

- 一张原图，对应多段音频
- 每段音频都已经有词级 OCR 框和 TTS 时间戳
- 播放时需要按语音进度推进高亮区域
- 需要图文高亮模式或纯文字阅读模式

## 快速接入

```vue
<template>
  <SvgSequencePlayer
    ref="playerRef"
    :image-url="imageUrl"
    :segment-assets="segmentAssets"
    :source-image-width="1235"
    :source-image-height="774"
    display-mode="image"
    :playback-rate="1"
    @finished="handleFinished"
    @state-change="handleStateChange"
    @progress-change="handleProgressChange"
  />

  <div class="actions">
    <button @click="playerRef?.playAll()">播放全部</button>
    <button @click="playerRef?.playSegment(0)">播放第 1 段</button>
    <button @click="playerRef?.seekSegmentToProgress(0, 0.5)">
      第 1 段跳到 50%
    </button>
    <button @click="playerRef?.togglePause()">暂停 / 继续</button>
    <button @click="playerRef?.stop()">停止</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  SvgSequencePlayer,
  type PlayerState,
  type SegmentAsset,
  type SvgSequencePlayerExpose,
  type SvgSequencePlayerProgress,
} from "./src/components/svg-sequence-player";

const playerRef = ref<SvgSequencePlayerExpose | null>(null);

const imageUrl = "/assets/test.png";
const segmentAssets = ref<SegmentAsset[]>([
  {
    id: "segment-1",
    audio_url: "/assets/seg-1.mp3",
    highlightColor: "#f2b4ae",
    text: "第一段文本",
    ocr_tts: [
      {
        text: "第一",
        rotated_rect: [120, 80, 48, 24, 0],
        begin_time: 0,
        end_time: 320,
      },
      {
        text: "段",
        rotated_rect: [176, 80, 24, 24, 0],
        begin_time: 320,
        end_time: 560,
      },
    ],
  },
]);

function handleFinished() {
  console.log("播放完成");
}

function handleStateChange(state: PlayerState) {
  console.log("播放器状态", state);
}

function handleProgressChange(progress: SvgSequencePlayerProgress) {
  console.log("播放进度", progress);
}
</script>
```

## 数据要求

组件真正消费的是 `SegmentAsset[]`：

```ts
type SegmentAsset = {
  id?: string;
  audio_url: string;
  highlightColor?: string;
  text: string;
  ocr_tts: {
    text: string;
    rotated_rect: [number, number, number, number, number] | number[];
    begin_time: number | string;
    end_time: number | string;
  }[];
};
```

说明：

- `audio_url` 必填，不能为空
- `highlightColor` 可选，用于覆盖该 segment 的进度背景/高亮颜色；不传时使用组件级 `highlightColor`
- 单个 segment 的 `ocr_tts` 必填，且至少要有 1 个词
- `segmentAssets` 可以传空数组；此时组件不会播放段落，但 `imageUrl` 对应的图片会正常展示
- `rotated_rect` 当前至少会读取前 4 位，按 `[centerX, centerY, width, height, angle]` 处理
- `begin_time` / `end_time` 单位为毫秒
- 如果某个词缺少合法时间，组件仍会渲染，但该词不会参与时间驱动高亮

## Props

| Prop | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `imageUrl` | `string` | 是 | - | 共享底图地址 |
| `segmentAssets` | `SegmentAsset[]` | 是 | - | 分段音频与词级 OCR/TTS 数据 |
| `sourceImageWidth` | `number` | 否 | 自动推断 | 原图宽度；不传时优先从 `imageUrl` 解析 |
| `sourceImageHeight` | `number` | 否 | 自动推断 | 原图高度；不传时优先从 `imageUrl` 解析 |
| `showOutline` | `boolean` | 否 | `false` | 是否显示每行基础描边框 |
| `highlightColor` | `string` | 否 | `#f2b4ae` | 高亮颜色 |
| `highlightRadius` | `number` | 否 | `0` | 高亮圆角半径 |
| `playbackRate` | `number` | 否 | `1` | 播放倍速，非法值会回退到 `1` |
| `displayMode` | `"image" \| "text"` | 否 | `"image"` | `image` 为图文高亮，`text` 为纯文字滚动模式 |
| `autoFollowText` | `boolean` | 否 | `true` | 纯文字模式下是否自动跟随当前激活行 |
| `autoFollowResumeDelayMs` | `number` | 否 | `1800` | 用户手动滚动后，恢复自动跟随的延时 |

补充说明：

- 传入 `sourceImageWidth` / `sourceImageHeight` 可以避免组件额外解析图片尺寸
- 如需每个段落不同颜色，在对应 `segmentAssets[index].highlightColor` 传入颜色值即可；该颜色会同时作用于图文高亮模式和纯文字进度背景
- 如果图片尺寸也拿不到，组件会退回到基于 OCR 词框推导出的最小可用尺寸
- `imageUrl`、`segmentAssets`、`sourceImageWidth`、`sourceImageHeight` 变化时，组件会停止当前播放并重新构建内部模型
- `segmentAssets` 使用深度监听，调用方原地修改 `ocr_tts` 中的词文本、时间戳或坐标时，也会触发重新加载

## 事件

| 事件名 | 参数 | 说明 |
| --- | --- | --- |
| `finished` | 无 | 全部 segment 顺序播放完成后触发 |
| `state-change` | `PlayerState` | 播放器状态变化时触发 |
| `progress-change` | `SvgSequencePlayerProgress` | 播放、暂停、停止、拖拽 seek 或模型重建导致进度变化时触发 |

`PlayerState` 可选值：

- `loading`
- `idle`
- `playing`
- `paused`
- `error`

`SvgSequencePlayerProgress` 字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `segmentIndex` | `number` | 当前激活 segment 下标，未定位时为 `-1` |
| `segmentId` | `string \| null` | 当前激活 segment 的 id，未定位时为 `null` |
| `segmentCount` | `number` | 当前数据源中的 segment 总数 |
| `currentTimeMs` | `number` | 按全部 segment 累计后的当前播放时间，单位毫秒 |
| `durationMs` | `number` | 全部 segment 的累计总时长，单位毫秒 |
| `segmentTimeMs` | `number` | 当前 segment 内部的播放时间，单位毫秒 |
| `segmentDurationMs` | `number` | 当前 segment 的总时长，单位毫秒 |
| `progress` | `number` | 全部 segment 维度的播放进度，范围 `0` 到 `1` |

## 暴露方法

通过 `ref` 可调用以下方法：

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `playAll()` | `Promise<void>` | 从头顺序播放全部 segment |
| `playSegment(index)` | `Promise<void>` | 播放指定下标的单个 segment，`index` 从 `0` 开始 |
| `pause()` | `void` | 暂停播放 |
| `resume()` | `Promise<void>` | 从暂停状态恢复播放 |
| `togglePause()` | `void` | 在暂停与继续之间切换 |
| `stop()` | `void` | 停止播放并回到可重播状态 |
| `getState()` | `PlayerState` | 获取当前播放器状态 |
| `getProgress()` | `SvgSequencePlayerProgress` | 获取当前播放器进度快照 |
| `seekToProgress(progress)` | `Promise<void>` | 按全部 segment 的累计进度跳转，`progress` 范围为 `0` 到 `1` |
| `seekSegmentToProgress(index, progress)` | `Promise<void>` | 按单个 segment 的进度跳转，`index` 从 `0` 开始，`progress` 范围为 `0` 到 `1` |

示例：

```ts
await playerRef.value?.playSegment(2); // 播放第 3 段
await playerRef.value?.seekSegmentToProgress(2, 0.5); // 第 3 段跳到 50%
```

`playSegment(index)` 不需要调用方重新裁剪或替换数据源。推荐一次性传入完整 `segmentAssets`，再通过该方法定位到具体段落播放。

`seekToProgress(progress)` 适合做“全部音频合集”的总进度条；如果页面上需要每段独立播放和拖拽，请使用 `seekSegmentToProgress(index, progress)`，避免拖动某段时影响其他段的进度。

## Demo 操作说明

当前 demo 页面包含几类操作：

- `开始顺序播放`：按当前 `segmentAssets` 从第一段播放到最后一段
- 每段独立控制条：每个 segment 都有自己的播放/暂停按钮和进度条
- `播放第 N 段` / `暂停第 N 段`：调用组件暴露的 `playSegment(index)`、`pause()` 或 `resume()`，只控制对应段
- 拖动第 N 段进度条：调用 `seekSegmentToProgress(index, progress)`，只调整该段音频进度，并同步图片高亮或纯文字高亮
- `切换纯文字` / `切换图文`：在图片高亮模式和纯文字滚动模式之间切换
- `切换到长文本 mock` / `切换到原有 mock`：在原有 5 段 mock 数据和新增的长文本单段 mock 数据之间交替切换，用来演示 `imageUrl`、图片尺寸和 `segmentAssets` 同时更新时组件会重新加载
- `异步加载并立即播放`：先把 `segmentAssets` 置为空数组，再延迟写入长文本 mock 数据，并立刻调用 `playSegment(0)`，用来演示异步数据刚更新后立即播放的场景

这些演示按钮都只更新父组件传给 `SvgSequencePlayer` 的 props，不需要卸载播放器组件。

## 现有示例数据来源

当前仓库里的 demo 数据流如下：

1. [src/mock/svg-player/manifest.json](/Users/pincoudeduanyin/Desktop/demo/ocr/svg-plater-vue2/src/mock/svg-player/manifest.json) 描述分段资源
2. [src/mock/svgPlayerMock.ts](/Users/pincoudeduanyin/Desktop/demo/ocr/svg-plater-vue2/src/mock/svgPlayerMock.ts) 将 `ocr.json` 和 `tts.json` 合并为组件所需的 `SegmentAsset[]`
3. [src/mock/svg-player/long-text.segment-assets.json](/Users/pincoudeduanyin/Desktop/demo/ocr/svg-plater-vue2/src/mock/svg-player/long-text.segment-assets.json) 提供新增的长文本单段 mock 数据
4. [src/App.vue](/Users/pincoudeduanyin/Desktop/demo/ocr/svg-plater-vue2/src/App.vue) 负责加载数据、切换 mock 数据并调用播放器暴露方法

如果你的数据源也是 `OCR JSON + TTS JSON` 分离存储，可以直接复用这个合并思路。
