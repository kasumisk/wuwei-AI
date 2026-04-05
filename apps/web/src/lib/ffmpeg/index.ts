import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loaded = false;
let loading = false;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && loaded) {
    return ffmpeg;
  }

  // 防止重复加载
  if (loading) {
    // 等待加载完成
    while (loading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (ffmpeg && loaded) {
      return ffmpeg;
    }
  }

  loading = true;

  try {
    ffmpeg = new FFmpeg();

    // 监听日志以便调试
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    // 检测是否支持多线程（SharedArrayBuffer）
    const useMultiThread = checkSharedArrayBufferSupport();
    console.log('[FFmpeg] SharedArrayBuffer support:', useMultiThread);

    if (useMultiThread) {
      // 多线程版本 - 性能更好，需要 SharedArrayBuffer
      // @ffmpeg/core-mt 是多线程版本
      const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd';
      console.log('[FFmpeg] Loading multi-thread version from:', baseURL);
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
      });
    } else {
      // 单线程版本 - 兼容性更好，不需要 SharedArrayBuffer
      // @ffmpeg/core 是单线程版本
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      console.log('[FFmpeg] Loading single-thread version from:', baseURL);
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
    }

    loaded = true;
    return ffmpeg;
  } catch (error) {
    console.error('FFmpeg 加载失败:', error);
    ffmpeg = null;
    throw error;
  } finally {
    loading = false;
  }
}

// 检查是否支持 SharedArrayBuffer
export function checkSharedArrayBufferSupport(): boolean {
  try {
    // 检查 SharedArrayBuffer 是否存在且可用
    if (typeof SharedArrayBuffer === 'undefined') {
      return false;
    }
    // 尝试创建一个小的 SharedArrayBuffer 来验证
    new SharedArrayBuffer(1);
    return true;
  } catch {
    return false;
  }
}

export { fetchFile };

// 视频格式信息
export const videoFormats = [
  { value: 'mp4', label: 'MP4', mimeType: 'video/mp4', desc: '通用性最好' },
  { value: 'webm', label: 'WebM', mimeType: 'video/webm', desc: '网页优化' },
  { value: 'mov', label: 'MOV', mimeType: 'video/quicktime', desc: 'Apple 设备' },
  { value: 'avi', label: 'AVI', mimeType: 'video/x-msvideo', desc: 'Windows 兼容' },
  { value: 'mkv', label: 'MKV', mimeType: 'video/x-matroska', desc: '高质量容器' },
  { value: 'gif', label: 'GIF', mimeType: 'image/gif', desc: '动图格式' },
];

// 视频编码器
export const videoCodecs = [
  { value: 'libx264', label: 'H.264', desc: '兼容性最好' },
  { value: 'libx265', label: 'H.265/HEVC', desc: '更高压缩率' },
  { value: 'libvpx-vp9', label: 'VP9', desc: 'WebM 推荐' },
];

// 音频编码器
export const audioCodecs = [
  { value: 'aac', label: 'AAC', desc: '推荐' },
  { value: 'mp3', label: 'MP3', desc: '通用' },
  { value: 'opus', label: 'Opus', desc: 'WebM 推荐' },
];

// 预设压缩配置
export const compressionPresets = [
  { value: 'ultrafast', label: '极速', crf: 28 },
  { value: 'fast', label: '快速', crf: 26 },
  { value: 'medium', label: '平衡', crf: 23 },
  { value: 'slow', label: '高质量', crf: 20 },
  { value: 'veryslow', label: '最高质量', crf: 18 },
];

// 分辨率预设
export const resolutionPresets = [
  { value: 'original', label: '保持原始', width: 0, height: 0 },
  { value: '4k', label: '4K (3840×2160)', width: 3840, height: 2160 },
  { value: '1080p', label: '1080p (1920×1080)', width: 1920, height: 1080 },
  { value: '720p', label: '720p (1280×720)', width: 1280, height: 720 },
  { value: '480p', label: '480p (854×480)', width: 854, height: 480 },
  { value: '360p', label: '360p (640×360)', width: 640, height: 360 },
];

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化时间
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 获取视频信息
export async function getVideoInfo(
  file: File
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('无法读取视频信息'));
    };

    video.src = URL.createObjectURL(file);
  });
}
