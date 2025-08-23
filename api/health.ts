import { NextRequest } from 'next/server';
import { createClient } from '@libsql/client';

export const config = { runtime: 'edge' };

export default async function handler(_req: NextRequest) {
  try {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (url && authToken) {
      const client = createClient({ url, authToken });
      // simple ping
      await client.execute('SELECT 1');
    }
    return new Response(JSON.stringify({ success: true, data: 'OK', error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, data: null, error: e?.message || 'error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}