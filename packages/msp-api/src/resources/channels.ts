import type { Channel, ChannelListResponse } from '@1440io/msp-types';
import { Resource, type RequestOverrides } from './base.js';

/** The channels configured for the authenticated org. */
export class ChannelsResource extends Resource {
  /** List every active channel, with its platform, id, and external id. */
  async list(options: RequestOverrides = {}): Promise<Channel[]> {
    const response = await this.http.request<ChannelListResponse>({
      method: 'GET',
      path: '/api/v0/channels',
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    return response.channels;
  }
}
