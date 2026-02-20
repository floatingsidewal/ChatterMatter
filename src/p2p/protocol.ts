/**
 * Message encoding/decoding for the WebSocket transport.
 *
 * Uses MessagePack for application-level messages.
 * Yjs sync and awareness messages carry raw binary payloads.
 */

import { pack, unpack } from "msgpackr";
import type { Message } from "./types.js";

/**
 * Encode a message to a binary buffer for WebSocket transport.
 */
export function encodeMessage(msg: Message): Uint8Array {
  // For sync and awareness messages, the data field is already Uint8Array.
  // MessagePack handles Uint8Array natively (as Buffer/bin).
  return pack(msg);
}

/**
 * Decode a binary WebSocket message back to a Message.
 */
export function decodeMessage(data: Uint8Array | ArrayBuffer | Buffer): Message {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  return unpack(buf) as Message;
}
