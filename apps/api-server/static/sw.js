// 空Service Worker文件
// 这个文件用于处理浏览器对Service Worker的请求
// 防止404错误

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 不做任何缓存或网络请求拦截
