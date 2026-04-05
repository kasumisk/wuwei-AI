'use client';

import { useState, useCallback, useEffect } from 'react';
import { appFileService, type UploadResult } from '@/lib/api/app-file';
import { appAuthService } from '@/lib/api/user/auth';
import { clientAPI } from '@/lib/api/client-api';
import { Button } from '@/components/ui/button';

/**
 * App 用户文件上传示例组件
 * 演示通过服务器中转上传和预签名 URL 直传两种方式
 */
export function AppFileUploadDemo() {
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [directUploadResult, setDirectUploadResult] = useState<{ key: string; url: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'server' | 'direct'>('server');

  // 认证状态
  const [authStatus, setAuthStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [authUser, setAuthUser] = useState<string | null>(null);

  // 组件挂载时自动匿名登录（如果还没有 token）
  useEffect(() => {
    const existingToken = localStorage.getItem('auth_token');
    if (existingToken) {
      setAuthStatus('ok');
      setAuthUser('已登录（复用已有 token）');
      return;
    }

    setAuthStatus('loading');
    // 生成稳定的 deviceId（每次刷新复用同一设备标识）
    let deviceId = localStorage.getItem('demo_device_id');
    if (!deviceId) {
      deviceId = `demo-${crypto.randomUUID()}`;
      localStorage.setItem('demo_device_id', deviceId);
    }

    appAuthService.anonymousLogin(deviceId)
      .then((res) => {
        clientAPI.setAuthToken(res.token);
        setAuthStatus('ok');
        setAuthUser(`匿名用户 (id: ${res.user.id.slice(0, 8)}...)`);
      })
      .catch((err) => {
        setAuthStatus('error');
        setError(`自动登录失败: ${err.message}`);
      });
  }, []);

  // 通过服务器中转上传
  const handleServerUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setProgress(0);
    setUploadResult(null);

    try {
      const result = await appFileService.upload(file, 'image', (percent) => {
        setProgress(percent);
      });
      setUploadResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, []);

  // 预签名 URL 直传
  const handleDirectUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setDirectUploadResult(null);

    try {
      const result = await appFileService.directUpload(file, 'image');
      setDirectUploadResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* 认证状态栏 */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded text-sm border ${
        authStatus === 'ok' ? 'bg-green-50 border-green-200 text-green-800' :
        authStatus === 'loading' ? 'bg-blue-50 border-blue-200 text-blue-800' :
        authStatus === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
        'bg-gray-50 border-gray-200 text-gray-600'
      }`}>
        <span className="font-semibold">认证状态：</span>
        {authStatus === 'loading' && <span className="animate-pulse">自动匿名登录中...</span>}
        {authStatus === 'ok' && <span>✓ {authUser}</span>}
        {authStatus === 'error' && <span>✗ 未认证（上传会返回 401）</span>}
        {authStatus === 'idle' && <span>初始化中...</span>}
      </div>

      {/* 模式切换 */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'server' ? 'default' : 'outline'}
          onClick={() => setMode('server')}
          size="sm"
        >
          服务器中转上传
        </Button>
        <Button
          variant={mode === 'direct' ? 'default' : 'outline'}
          onClick={() => setMode('direct')}
          size="sm"
        >
          预签名直传
        </Button>
      </div>

      {/* 模式说明 */}
      <div className="text-sm text-gray-600 bg-gray-50 dark:bg-gray-800 p-3 rounded">
        {mode === 'server' ? (
          <>
            <strong>服务器中转模式：</strong>文件先上传到后端服务器，服务器再转存到 S3/R2。
            适合需要在服务端处理（如校验、压缩、水印）的场景。支持上传进度回调。
          </>
        ) : (
          <>
            <strong>预签名直传模式：</strong>后端生成一个临时上传 URL，前端直接将文件上传到 S3/R2，
            不经过后端服务器。适合大文件上传，减轻服务器压力。
          </>
        )}
      </div>

      {/* 文件选择 */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <input
          type="file"
          accept="image/*"
          onChange={mode === 'server' ? handleServerUpload : handleDirectUpload}
          disabled={uploading || authStatus !== 'ok'}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4
            file:rounded-md file:border-0 file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100
            disabled:opacity-50"
        />
        <p className="mt-2 text-xs text-gray-500">支持 JPG, PNG, GIF, WebP 等图片格式</p>
      </div>

      {/* 上传进度 */}
      {uploading && mode === 'server' && progress > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>上传中...</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {uploading && mode === 'direct' && (
        <div className="text-sm text-blue-600 animate-pulse">正在直传到存储服务...</div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {/* 服务器中转上传结果 */}
      {uploadResult && (
        <div className="bg-green-50 border border-green-200 rounded p-4 space-y-2">
          <h4 className="font-semibold text-green-800">上传成功 ✓</h4>
          <div className="text-sm space-y-1">
            <p><strong>文件名：</strong>{uploadResult.originalName}</p>
            <p><strong>大小：</strong>{formatBytes(uploadResult.size)}</p>
            <p><strong>MD5：</strong><code className="bg-black/10 px-1 rounded">{uploadResult.md5}</code></p>
            <p><strong>类型：</strong>{uploadResult.mimeType}</p>
            <p><strong>Key：</strong><code className="bg-black/10 px-1 rounded text-xs">{uploadResult.key}</code></p>
            <p>
              <strong>URL：</strong>
              <a href={uploadResult.url} target="_blank" rel="noreferrer" className="text-blue-600 break-all underline">
                {uploadResult.url}
              </a>
            </p>
          </div>
          {uploadResult.mimeType.startsWith('image/') && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadResult.url}
              alt="Preview"
              className="mt-2 max-w-xs rounded border"
            />
          )}
        </div>
      )}

      {/* 直传上传结果 */}
      {directUploadResult && (
        <div className="bg-green-50 border border-green-200 rounded p-4 space-y-2">
          <h4 className="font-semibold text-green-800">直传成功 ✓</h4>
          <div className="text-sm space-y-1">
            <p><strong>Key：</strong><code className="bg-black/10 px-1 rounded text-xs">{directUploadResult.key}</code></p>
            <p>
              <strong>URL：</strong>
              <a href={directUploadResult.url} target="_blank" rel="noreferrer" className="text-blue-600 break-all underline">
                {directUploadResult.url}
              </a>
            </p>
          </div>
        </div>
      )}

      {/* 代码示例 */}
      <div className="space-y-3">
        <h4 className="font-semibold">代码示例</h4>
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{mode === 'server'
  ? `import { appFileService } from '@/lib/api/app-file';

// 通过服务器中转上传
const result = await appFileService.upload(
  file,        // File 对象
  'image',     // 分类: general | image | avatar | document
  (percent) => console.log(\`进度: \${percent}%\`),
);

console.log(result.url);  // 文件访问 URL
console.log(result.md5);  // 文件 MD5
console.log(result.size); // 文件大小（字节）`
  : `import { appFileService } from '@/lib/api/app-file';

// 预签名 URL 直传（不经过后端服务器）
const result = await appFileService.directUpload(
  file,    // File 对象
  'image', // 分类
);

console.log(result.url); // 文件访问 URL
console.log(result.key); // 存储 Key`}
        </pre>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
