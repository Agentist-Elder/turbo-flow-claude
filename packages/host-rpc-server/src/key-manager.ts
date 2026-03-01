/**
 * Phase 8 — ED25519 Key Manager (Node.js built-in crypto only)
 *
 * Uses Node's native `node:crypto` module for all key operations.
 * No external crypto libraries are imported.
 *
 * File persistence format: private key JWK (JSON), which includes both
 * the `d` (private) and `x` (public) fields as base64url-encoded 32-byte values.
 */

import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  KeyObject,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export interface Ed25519Keypair {
  /** Node.js KeyObject for signing (pass to crypto.sign). */
  privateKey: KeyObject;
  /** Node.js KeyObject (pass to crypto.verify, if needed). */
  publicKey: KeyObject;
  /**
   * Raw 32-byte public key bytes.
   * Used when building FlatBuffers Ed25519PublicKey structs.
   */
  publicKeyBytes: Uint8Array;
}

/** Generate a fresh ED25519 keypair using Node's native CSPRNG. */
export function generateKeypair(): Ed25519Keypair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const publicKeyBytes = new Uint8Array(Buffer.from(jwk.x, 'base64url'));
  return { privateKey, publicKey, publicKeyBytes };
}

/**
 * Save a keypair to a file as a JWK JSON string.
 * The private-key JWK includes both `d` and `x` fields (private + public).
 */
export async function saveKeypairToFile(path: string, keypair: Ed25519Keypair): Promise<void> {
  const jwk = keypair.privateKey.export({ format: 'jwk' });
  await writeFile(path, JSON.stringify(jwk), 'utf-8');
}

/** Load a keypair from a JWK JSON file previously written by `saveKeypairToFile`. */
export async function loadKeypairFromFile(path: string): Promise<Ed25519Keypair> {
  const raw = await readFile(path, 'utf-8');
  const jwk = JSON.parse(raw) as { d: string; x: string };
  const privateKey = createPrivateKey({ format: 'jwk', key: jwk });
  const publicKey  = createPublicKey(privateKey);
  const publicKeyBytes = new Uint8Array(Buffer.from(jwk.x, 'base64url'));
  return { privateKey, publicKey, publicKeyBytes };
}
