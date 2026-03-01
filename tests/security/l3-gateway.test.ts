/**
 * Phase 9 — L3 Gateway integration tests
 *
 * Verifies the HTTP front door for System 1:
 *   - Rejects non-octet-stream payloads with 415 Unsupported Media Type.
 *   - Accepts application/octet-stream payloads, signs them via Phase 8
 *     KeyManager + ProvenanceBuilder, and returns RC_ALLOW from the WASM gate.
 *   - Returns a 4-byte LE uint32 RC code as application/octet-stream.
 *   - Handles non-existent routes with 404 and oversized bodies with 413.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { join } from 'node:path';
import { WasmGateBridge, RC_ALLOW } from '../../packages/host-rpc-server/src/wasm-bridge.js';
import { L3Gateway } from '../../packages/host-rpc-server/src/l3-gateway.js';

const WASM_PATH = join(
  process.cwd(),
  'target/wasm32-unknown-unknown/release/wasm_security_gate.wasm',
);

// ---------------------------------------------------------------------------
// HTTP helper — thin wrapper around node:http
// ---------------------------------------------------------------------------

interface HttpResult {
  status: number;
  contentType: string;
  body: Buffer;
}

function httpPost(
  port: number,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path,
        headers: { 'Content-Type': contentType, 'Content-Length': body.byteLength } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: (res.headers['content-type'] ?? '').split(';')[0]!.trim(),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function httpGet(port: number, path: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: (res.headers['content-type'] ?? '').split(';')[0]!.trim(),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe('L3Gateway — /api/v1/verify-coherence', () => {
  let gateway: L3Gateway;
  let port: number;

  beforeAll(async () => {
    const bridge = await WasmGateBridge.create(WASM_PATH);
    gateway = L3Gateway.create({ bridge });
    await gateway.listen(0); // OS-assigned port
    port = (gateway.address as { port: number }).port;
  });

  afterAll(async () => {
    await gateway.close();
  });

  // -------------------------------------------------------------------------
  // Content-type enforcement — 415 Unsupported Media Type
  // -------------------------------------------------------------------------

  it('rejects application/json with 415', async () => {
    const { status } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.from('{"coherence":1}'), 'application/json',
    );
    expect(status).toBe(415);
  });

  it('rejects text/plain with 415', async () => {
    const { status } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.from('hello'), 'text/plain',
    );
    expect(status).toBe(415);
  });

  it('rejects application/x-www-form-urlencoded with 415', async () => {
    const { status } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.from('a=b'), 'application/x-www-form-urlencoded',
    );
    expect(status).toBe(415);
  });

  it('rejects missing Content-Type with 415', async () => {
    // No Content-Type header → ct resolves to '' → not octet-stream
    const { status } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.from([0x01, 0x02]), '',
    );
    expect(status).toBe(415);
  });

  // -------------------------------------------------------------------------
  // Routing — 404 for wrong method / path
  // -------------------------------------------------------------------------

  it('GET to verify path returns 404', async () => {
    const { status } = await httpGet(port, '/api/v1/verify-coherence');
    expect(status).toBe(404);
  });

  it('POST to unknown path returns 404', async () => {
    const { status } = await httpPost(
      port, '/api/v1/unknown',
      Buffer.from([0x00]), 'application/octet-stream',
    );
    expect(status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Happy path — octet-stream → sign → WASM gate → RC_ALLOW
  // -------------------------------------------------------------------------

  it('arbitrary bytes with octet-stream return 200 with RC_ALLOW', async () => {
    const { status, contentType, body } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.from([0x01, 0x02, 0x03, 0x04]), 'application/octet-stream',
    );
    expect(status).toBe(200);
    expect(contentType).toBe('application/octet-stream');
    expect(body.byteLength).toBe(4);
    expect(body.readUInt32LE(0)).toBe(RC_ALLOW);
  });

  it('empty body with octet-stream returns RC_ALLOW', async () => {
    const { status, body } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.alloc(0), 'application/octet-stream',
    );
    expect(status).toBe(200);
    expect(body.readUInt32LE(0)).toBe(RC_ALLOW);
  });

  it('larger body (4 KiB) returns RC_ALLOW', async () => {
    const { status, body } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.alloc(4096, 0x55), 'application/octet-stream',
    );
    expect(status).toBe(200);
    expect(body.readUInt32LE(0)).toBe(RC_ALLOW);
  });

  it('three sequential requests all return RC_ALLOW', async () => {
    for (let i = 0; i < 3; i++) {
      const { status, body } = await httpPost(
        port, '/api/v1/verify-coherence',
        Buffer.from([i, i + 1, i + 2]), 'application/octet-stream',
      );
      expect(status).toBe(200);
      expect(body.readUInt32LE(0)).toBe(RC_ALLOW);
    }
  });

  // -------------------------------------------------------------------------
  // Oversized body — 413
  // -------------------------------------------------------------------------

  it('body exceeding 64 KiB returns 413', async () => {
    const { status } = await httpPost(
      port, '/api/v1/verify-coherence',
      Buffer.alloc(64 * 1024 + 1), 'application/octet-stream',
    );
    expect(status).toBe(413);
  });
});
