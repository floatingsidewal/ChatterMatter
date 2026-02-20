/**
 * Presence and awareness for collaborative review sessions.
 *
 * Wraps Yjs Awareness protocol to track who is online,
 * what section they're viewing, and typing indicators.
 */

import { Awareness } from "y-protocols/awareness.js";
import type * as Y from "yjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceState {
  name: string;
  color: string;
  /** Which anchor/section the peer is currently viewing. */
  activeAnchor?: string;
  /** Whether the peer is composing a comment. */
  isTyping?: boolean;
  /** Timestamp of last activity. */
  lastActive: number;
}

export interface PeerPresence {
  clientId: number;
  state: PresenceState;
}

// ---------------------------------------------------------------------------
// Color pool for assigning peer colors
// ---------------------------------------------------------------------------

const COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

let colorIndex = 0;

function nextColor(): string {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return color;
}

// ---------------------------------------------------------------------------
// Awareness wrapper
// ---------------------------------------------------------------------------

export class PresenceManager {
  readonly awareness: Awareness;
  private localName: string;
  private localColor: string;

  constructor(doc: Y.Doc, name: string) {
    this.awareness = new Awareness(doc);
    this.localName = name;
    this.localColor = nextColor();

    this.setLocal({
      name: this.localName,
      color: this.localColor,
      lastActive: Date.now(),
    });
  }

  /**
   * Update local presence state.
   */
  setLocal(state: Partial<PresenceState>): void {
    const current = (this.awareness.getLocalState() as PresenceState | null) ?? {
      name: this.localName,
      color: this.localColor,
      lastActive: Date.now(),
    };
    this.awareness.setLocalState({ ...current, ...state, lastActive: Date.now() });
  }

  /**
   * Signal that the user is viewing a specific anchor/section.
   */
  setActiveAnchor(anchor: string | undefined): void {
    this.setLocal({ activeAnchor: anchor });
  }

  /**
   * Signal typing state.
   */
  setTyping(isTyping: boolean): void {
    this.setLocal({ isTyping });
  }

  /**
   * Get all current peer presence states (excluding local).
   */
  getPeers(): PeerPresence[] {
    const states = this.awareness.getStates();
    const localId = this.awareness.clientID;
    const peers: PeerPresence[] = [];

    states.forEach((state, clientId) => {
      if (clientId !== localId && state) {
        peers.push({ clientId, state: state as PresenceState });
      }
    });

    return peers;
  }

  /**
   * Get all presence states including local.
   */
  getAll(): PeerPresence[] {
    const states = this.awareness.getStates();
    const all: PeerPresence[] = [];

    states.forEach((state, clientId) => {
      if (state) {
        all.push({ clientId, state: state as PresenceState });
      }
    });

    return all;
  }

  /**
   * Listen for presence changes. Returns cleanup function.
   */
  onChange(
    callback: (added: number[], updated: number[], removed: number[]) => void,
  ): () => void {
    const handler = (
      changes: { added: number[]; updated: number[]; removed: number[] },
    ) => {
      callback(changes.added, changes.updated, changes.removed);
    };

    this.awareness.on("change", handler);
    return () => this.awareness.off("change", handler);
  }

  /**
   * Clean up awareness on disconnect.
   */
  destroy(): void {
    this.awareness.destroy();
  }
}
