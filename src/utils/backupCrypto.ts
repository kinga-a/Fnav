import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 100000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hasWebCrypto(): boolean {
  return typeof globalThis.crypto !== 'undefined'
    && typeof globalThis.crypto.subtle !== 'undefined'
    && typeof globalThis.crypto.subtle.importKey === 'function';
}

function deriveNobleKey(password: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, encoder.encode(password), salt, { c: ITERATIONS, dkLen: 32 });
}

async function deriveWebKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedBackup {
  encrypted: true;
  v: 1;
  salt: string;
  iv: string;
  data: string;
}

export function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.encrypted === true
    && candidate.v === 1
    && typeof candidate.salt === 'string'
    && typeof candidate.iv === 'string'
    && typeof candidate.data === 'string';
}

export async function encryptBackup(payload: unknown, password: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(payload));

  let cipher: Uint8Array;
  if (hasWebCrypto()) {
    const key = await deriveWebKey(password, salt);
    const result = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    cipher = new Uint8Array(result);
  } else {
    // HTTP 局域网（非安全上下文）下浏览器禁用 Web Crypto，回退到纯 JS 实现
    const key = deriveNobleKey(password, salt);
    cipher = gcm(key, iv).encrypt(plaintext);
  }

  return {
    encrypted: true,
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(cipher),
  };
}

export async function decryptBackup<T>(payload: EncryptedBackup, password: string): Promise<T> {
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const cipher = fromBase64(payload.data);

  let plain: Uint8Array;
  if (hasWebCrypto()) {
    const key = await deriveWebKey(password, salt);
    const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    plain = new Uint8Array(result);
  } else {
    const key = deriveNobleKey(password, salt);
    plain = gcm(key, iv).decrypt(cipher);
  }

  return JSON.parse(decoder.decode(plain)) as T;
}