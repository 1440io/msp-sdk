import type { MediaAccessUrlSuccess, MediaUploadSuccess } from '@1440io/msp-types';
import { MspConfigError } from '../errors.js';
import { Resource, type RequestOverrides } from './base.js';

/** Bytes the upload route accepts as a request body. */
export type UploadBody = Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array> | string;

export interface UploadMediaParams extends RequestOverrides {
  /** The bytes to upload. */
  body: UploadBody;
  /** Original file name. Sanitized and truncated to 255 chars server-side. */
  filename: string;
  /** MIME type. Required in practice for TikTok (`image/jpeg` or `image/png`). */
  contentType?: string;
  /** Destination channel. Only `amb` is accepted today. */
  targetChannel?: 'amb';
  /**
   * Declared body size. Inferred from `body` when it exposes a length; supply
   * it yourself when streaming so the ceiling is checked before the transfer.
   */
  contentLength?: number;
}

/** Size ceiling for an uploaded asset: 100 MiB. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Media attachments: uploading bytes and minting signed read URLs. */
export class MediaResource extends Resource {
  /**
   * Stream a media asset to storage and get back its `mediaAssetId`, which you
   * pass as an `attachmentId` when sending a message.
   *
   * The default timeout is raised to two minutes for uploads.
   */
  async upload(params: UploadMediaParams): Promise<MediaUploadSuccess> {
    if (!params.filename) throw new MspConfigError('filename is required for a media upload');

    const declaredLength = params.contentLength ?? inferLength(params.body);
    if (declaredLength !== undefined && declaredLength > MAX_UPLOAD_BYTES) {
      throw new MspConfigError(
        `Asset is ${declaredLength} bytes, over the ${MAX_UPLOAD_BYTES}-byte upload ceiling`,
      );
    }

    return this.http.request<MediaUploadSuccess>({
      method: 'POST',
      path: '/api/v0/media/upload',
      rawBody: toBodyInit(params.body),
      headers: {
        ...params.headers,
        'content-type': params.contentType ?? 'application/octet-stream',
        'x-original-filename': params.filename,
        ...(params.targetChannel ? { 'x-target-channel': params.targetChannel } : {}),
        ...(declaredLength !== undefined ? { 'content-length': String(declaredLength) } : {}),
      },
      signal: params.signal,
      timeoutMs: params.timeoutMs ?? 120_000,
    });
  }

  /**
   * Mint a short-lived signed read URL for an attachment. Treat the URL as a
   * secret and do not cache it past `expiresAt`.
   */
  async getAccessUrl(
    attachmentId: string,
    options: RequestOverrides = {},
  ): Promise<MediaAccessUrlSuccess> {
    return this.http.request<MediaAccessUrlSuccess>({
      method: 'GET',
      path: `/api/v0/media/attachments/${encodeURIComponent(attachmentId)}/access-url`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}

function inferLength(body: UploadBody): number | undefined {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  return undefined;
}

function toBodyInit(body: UploadBody): BodyInit {
  // A Uint8Array view can be a window onto a larger buffer, so slice to the view.
  if (body instanceof Uint8Array) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }
  return body as BodyInit;
}
