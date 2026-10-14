import { NextRequest, NextResponse } from 'next/server';
import { rejectUnsafeWrite } from '@/lib/server/request-boundary';

export function proxy(request: NextRequest) {
  const error = rejectUnsafeWrite(request);
  return error ? NextResponse.json({ error }, { status: 403 }) : NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
