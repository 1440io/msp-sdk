import type { IntegrationTokenResponse } from '@1440io/msp-types';
import { Resource, type RequestOverrides } from './base.js';

/** Authentication routes. */
export class AuthResource extends Resource {
  /**
   * Exchange a long-lived integration API key for a short-lived business
   * access JWT (~15 minutes).
   *
   * The client does this for you when constructed with an `apiKey`; call it
   * directly only when you are managing token lifetime yourself. Never send
   * the raw API key on any other route.
   */
  async exchangeIntegrationToken(
    apiKey: string,
    options: RequestOverrides = {},
  ): Promise<IntegrationTokenResponse> {
    return this.http.request<IntegrationTokenResponse>({
      method: 'POST',
      path: '/api/auth/integration/token',
      auth: false,
      idempotent: true,
      headers: { ...options.headers, authorization: `Bearer ${apiKey}` },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
