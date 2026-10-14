import { describe, expect, it } from 'vitest';
import { rejectUnsafeWrite } from '@/lib/server/request-boundary';

describe('本地服务写入来源保护', () => {
  it('同源软件 JSON 请求允许写入', () => {
    const request = new Request('http://127.0.0.1:4123/api/stock', { method: 'POST', headers: { origin: 'http://127.0.0.1:4123', 'content-type': 'application/json' }, body: '{}' });
    expect(rejectUnsafeWrite(request)).toBeNull();
  });
  it('外来网页简单请求被拒绝', () => {
    const request = new Request('http://127.0.0.1:4123/api/stock', { method: 'POST', headers: { origin: 'https://external.invalid', 'content-type': 'text/plain' }, body: '{}' });
    expect(rejectUnsafeWrite(request)).not.toBeNull();
  });
  it('Next 将回环地址归一为 localhost 时，仍按真实 Host 校验浏览器来源', () => {
    const request = new Request('http://localhost:4123/api/stock', { method: 'POST', headers: { host: '127.0.0.1:4123', origin: 'http://127.0.0.1:4123', 'content-type': 'application/json' }, body: '{}' });
    expect(rejectUnsafeWrite(request)).toBeNull();
  });
  it('不同端口、其他回环主机和伪造转发头不能冒充当前来源', () => {
    for (const origin of ['http://127.0.0.1:4124', 'http://localhost:4123', 'https://external.invalid']) {
      const request = new Request('http://localhost:4123/api/stock', { method: 'POST', headers: { host: '127.0.0.1:4123', origin, 'x-forwarded-host': origin.replace(/^https?:\/\//, ''), 'content-type': 'application/json' }, body: '{}' });
      expect(rejectUnsafeWrite(request)).not.toBeNull();
    }
  });
  it('非浏览器验收工具无来源 JSON 请求可用，text/plain 不可用', () => {
    expect(rejectUnsafeWrite(new Request('http://localhost/api/stock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).toBeNull();
    expect(rejectUnsafeWrite(new Request('http://localhost/api/stock', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }))).not.toBeNull();
  });
});
