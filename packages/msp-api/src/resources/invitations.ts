import type { InvitationPreview } from '@1440io/msp-types';
import { Resource, type RequestOverrides } from './base.js';

/** Pending member invitations. */
export class InvitationsResource extends Resource {
  /** Preview a pending invitation by its token, before it is accepted. */
  async getByToken(token: string, options: RequestOverrides = {}): Promise<InvitationPreview> {
    return this.http.request<InvitationPreview>({
      method: 'GET',
      path: `/api/v0/invitations/by-token/${encodeURIComponent(token)}`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
