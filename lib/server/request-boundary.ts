/** Local desktop write boundary: browser pages may only mutate their own server. */
export function rejectUnsafeWrite(request: Request): string | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  const url = new URL(request.url);
  // NextURL 会把 127.0.0.1 归一为 localhost；浏览器 Origin 不会。
  // 以真实 HTTP Host 还原目标，不信任 x-forwarded-host，也不放开所有回环来源。
  const host = request.headers.get('host');
  let expected = url.origin;
  if (host) {
    try {
      const destination = new URL(`${url.protocol}//${host}`);
      if (destination.host !== host || destination.username || destination.password || destination.pathname !== '/') return '请求目标地址不正确。';
      expected = destination.origin;
    } catch { return '请求目标地址不正确。'; }
  }
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (origin && origin !== expected) return '拒绝来自其他页面的写入请求，请在本软件内操作。';
  if (site === 'cross-site') return '拒绝跨站写入请求。';
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType && !['application/json', 'multipart/form-data'].includes(contentType)) return '写入请求格式不正确，请在本软件内重新操作。';
  return null;
}
