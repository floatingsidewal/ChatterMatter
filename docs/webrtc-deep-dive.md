# WebRTC Deep Dive — How It Works and Why It Matters for ChatterMatter

## What WebRTC Is

WebRTC (Web Real-Time Communication) is a set of browser APIs and network protocols that enable **direct peer-to-peer data exchange** between two endpoints — without routing through a central server. It was designed for voice and video calls, but its **Data Channel** API is a general-purpose, low-latency, encrypted binary transport that works for any application data, including CRDT sync messages.

The critical insight: once a WebRTC connection is established, **data flows directly between peers**. No server sees the content. The server is only involved during the initial handshake (signaling).

## The Three Layers

WebRTC is not a single protocol — it's a stack of three layers that solve different problems:

```
┌──────────────────────────────────────────┐
│  Application Layer                       │
│  DataChannel API (SCTP)                  │
│  — ordered/unordered delivery            │
│  — reliable/unreliable modes             │
│  — binary and text messages              │
├──────────────────────────────────────────┤
│  Security Layer                          │
│  DTLS (Datagram TLS)                     │
│  — mandatory encryption                  │
│  — certificate-based authentication      │
│  — no opt-out (always encrypted)         │
├──────────────────────────────────────────┤
│  Transport Layer                         │
│  ICE + STUN + TURN                       │
│  — NAT traversal                         │
│  — candidate gathering                   │
│  — connectivity checks                   │
│  — relay fallback                        │
└──────────────────────────────────────────┘
```

Each layer can be understood independently.

---

## Layer 1: ICE — Getting Through the NAT

### The Problem

Most devices sit behind a NAT (Network Address Translation) router. The device has a private IP (e.g. `192.168.1.42`) that the outside world cannot reach directly. The router assigns a public-facing IP and port, but the mapping is ephemeral and unpredictable. Two peers behind different NATs cannot simply exchange IP addresses and connect.

### ICE (Interactive Connectivity Establishment)

ICE is the framework that solves this. It works in three phases:

**Phase 1 — Candidate Gathering**

Each peer collects every possible way it could be reached, called "candidates":

| Candidate Type | Source | Example |
|---|---|---|
| **host** | Local network interface | `192.168.1.42:54321` |
| **srflx** (server reflexive) | STUN server reveals the public IP:port the NAT assigned | `203.0.113.5:62000` |
| **relay** | TURN server allocates a relay address | `turn.example.com:443` |

The peer asks a STUN server "what is my public address?" — the STUN server sees the source IP of the incoming packet (the NAT's external mapping) and reports it back. This is cheap, fast, and stateless.

**Phase 2 — Candidate Exchange**

Both peers send their candidate lists to each other through the signaling channel (more on signaling below). Each peer now has a matrix of possible paths:

```
Peer A candidates × Peer B candidates = candidate pairs

Example:
  A-host  ↔ B-host      (same LAN? try it)
  A-host  ↔ B-srflx     (A on LAN, B's public NAT address)
  A-srflx ↔ B-srflx     (both behind NAT, public addresses)
  A-srflx ↔ B-relay     (B behind strict NAT, use TURN)
  A-relay ↔ B-relay     (both behind strict NAT, both relayed)
```

**Phase 3 — Connectivity Checks**

ICE tests each candidate pair by sending STUN binding requests. The pairs are prioritized: host-to-host is preferred (fastest), then server-reflexive, then relay (slowest). The first pair that gets a response wins.

```
Priority order:
  1. host ↔ host         (direct LAN — ~0ms added latency)
  2. srflx ↔ srflx       (direct through NAT — ~1-5ms)
  3. srflx ↔ relay       (one side relayed — ~10-50ms)
  4. relay ↔ relay        (both relayed — ~20-100ms)
```

### NAT Types and Why They Matter

Not all NATs are equal. The type of NAT determines which candidate pairs will succeed:

| NAT Type | Behavior | Peer-to-peer possible? |
|---|---|---|
| **Full Cone** | Any external host can send to the mapped port | Yes, easily |
| **Address-Restricted Cone** | Only hosts the internal device has sent to can reply | Yes, with STUN |
| **Port-Restricted Cone** | Only the specific host:port the device sent to can reply | Yes, with STUN (trickier) |
| **Symmetric** | Each outbound destination gets a different external port mapping | No direct P2P without TURN |

When both peers are behind symmetric NATs, the STUN-discovered address is useless because the NAT will assign a *different* port for the peer-to-peer connection than the one the STUN server saw. In this case, TURN relay is the only option.

### STUN vs TURN

**STUN** (Session Traversal Utilities for NAT):
- Lightweight, stateless protocol
- Peer asks "what is my public IP:port?"
- Server responds with the observed address
- No data relay — just address discovery
- Free/cheap to run (Google operates public STUN servers)
- ~90% of connections succeed with STUN alone

**TURN** (Traversal Using Relays around NAT):
- Heavyweight relay server
- All data flows through the TURN server
- Required when direct connectivity is impossible (symmetric NATs, strict firewalls)
- Expensive to run (bandwidth costs)
- ~10% of connections need TURN
- Supports TCP and UDP, plus TLS wrapping for firewall traversal

```
Without TURN (direct):
  Peer A ◄──────────────────────────► Peer B
                  ~5ms

With TURN (relayed):
  Peer A ◄────► TURN Server ◄────► Peer B
           ~25ms           ~25ms
                 total ~50ms
```

### ICE Trickle

Classically, ICE gathers ALL candidates before starting connectivity checks. **Trickle ICE** is an optimization where candidates are sent to the remote peer as soon as they're discovered, and connectivity checks begin immediately. This reduces connection setup time significantly (from seconds to sub-second).

---

## Layer 2: DTLS — Mandatory Encryption

Once ICE establishes a transport path, DTLS (Datagram Transport Layer Security) secures it. DTLS is TLS adapted for UDP datagrams (TLS requires reliable, ordered delivery — TCP — which UDP doesn't provide).

### How DTLS Works

1. **Handshake**: Both peers exchange certificates and negotiate a cipher suite. The handshake is similar to TLS 1.2/1.3 but handles packet loss and reordering.

2. **Certificate validation**: By default, WebRTC uses self-signed certificates. The fingerprint of each peer's certificate is included in the SDP offer/answer (exchanged via signaling). Each peer verifies that the remote certificate matches the fingerprint from the SDP. This prevents man-in-the-middle attacks even without a CA.

3. **Encryption**: All subsequent data is encrypted with the negotiated cipher (typically AES-128-GCM or AES-256-GCM).

Key point: **DTLS is mandatory in WebRTC**. There is no way to disable encryption. Every byte that flows over a WebRTC Data Channel is encrypted, authenticated, and integrity-checked.

### DTLS vs TLS

| Aspect | TLS (TCP) | DTLS (UDP) |
|---|---|---|
| Transport | Reliable, ordered (TCP) | Unreliable, unordered (UDP) |
| Packet loss handling | TCP retransmits | DTLS has its own retransmit timer |
| Head-of-line blocking | Yes (one lost packet blocks all) | No (each datagram independent) |
| Handshake | 1-2 RTT | 1-2 RTT + retransmit handling |
| Use case | Web browsing, APIs | Real-time media, data channels |

---

## Layer 3: SCTP and Data Channels

On top of DTLS sits **SCTP** (Stream Control Transmission Protocol), which provides the Data Channel abstraction.

### What SCTP Provides

SCTP is a transport protocol (like TCP or UDP) that runs *over* DTLS-encrypted UDP. It provides:

- **Multiple independent streams**: Each Data Channel is a separate SCTP stream. One slow/lossy channel doesn't block others.
- **Ordered or unordered delivery**: Each channel can choose. Ordered means messages arrive in send order (like TCP). Unordered means messages arrive as soon as possible (like UDP but reliable).
- **Reliable or unreliable delivery**: Reliable retransmits lost messages. Unreliable drops them (useful for real-time data where old messages are stale).
- **Message framing**: SCTP delivers discrete messages, not a byte stream. No need to implement your own framing/length-prefixing like with TCP.

### Data Channel Modes

When creating a Data Channel, you choose the delivery semantics:

```
Reliable + Ordered       → like TCP (default)
Reliable + Unordered     → messages arrive ASAP, all delivered, order not guaranteed
Unreliable + Ordered     → messages in order, but old ones may be dropped
Unreliable + Unordered   → like UDP with message framing
```

For ChatterMatter CRDT sync: **reliable + ordered** is the right choice. CRDT updates must all arrive (reliable) and applying them in order prevents unnecessary intermediate states.

### Data Channel vs Media Tracks

WebRTC has two data paths:

| Feature | Media Track | Data Channel |
|---|---|---|
| Content | Audio/video | Arbitrary binary/text |
| Protocol | RTP/RTCP over SRTP | SCTP over DTLS |
| Codec | Opus, VP8, H.264, etc. | None (raw data) |
| Latency | Ultra-low (sacrifices quality) | Low (reliable delivery) |
| Use case | Voice/video calls | Application data |

ChatterMatter uses **Data Channels only** — no media tracks.

---

## Signaling — The Bootstrap Problem

WebRTC is peer-to-peer, but peers need to find each other first. This chicken-and-egg problem is solved by **signaling**: an out-of-band channel where peers exchange the information needed to establish the WebRTC connection.

### What Gets Exchanged

Signaling exchanges two things:

**1. SDP (Session Description Protocol)**

SDP is a text format describing a peer's capabilities and connection parameters:

```
v=0
o=- 4611731400430051337 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:EsAw
a=ice-pwd:P2uYro0UCOQ4zxjKXaWCBui1
a=fingerprint:sha-256 D2:FA:0E:C3:...
a=setup:actpass
a=sctp-port:5000
```

The offer/answer exchange works like this:

```
Peer A                    Signaling Server                    Peer B
  │                              │                              │
  │──── createOffer() ──────────►│                              │
  │     SDP offer                │──── forward offer ──────────►│
  │                              │                              │
  │                              │◄──── createAnswer() ─────────│
  │◄──── forward answer ────────│     SDP answer                │
  │                              │                              │
```

**2. ICE Candidates**

As described above, each peer's ICE candidates are sent through the signaling channel to the other peer.

### Signaling is Not Specified by WebRTC

This is intentional. WebRTC does not mandate how signaling works — it could be:

- A WebSocket server (most common)
- HTTP polling
- A shared database
- Copy-pasting into a chat window (works for debugging)
- Carrier pigeon (technically possible)

The signaling channel is only used during connection setup. Once the WebRTC connection is established, signaling can be shut down entirely.

### The y-webrtc Signaling Server

The Yjs ecosystem provides a reference signaling server specifically designed for Yjs-over-WebRTC:

- Peers connect to the signaling server and announce which "room" (session) they're joining
- The signaling server forwards SDP offers/answers and ICE candidates between peers in the same room
- No document data ever passes through it
- Stateless — it doesn't store anything
- Can be a shared public instance or self-hosted

---

## Connection Lifecycle — Putting It All Together

Here's the complete sequence from "I want to connect" to "data is flowing":

```
 Peer A                  Signaling Server               Peer B
   │                           │                           │
   │ 1. Create RTCPeerConnection                           │
   │    Generate local ICE candidates                      │
   │                           │                           │
   │ 2. createOffer()          │                           │
   │──── SDP offer ───────────►│──── SDP offer ───────────►│
   │                           │                           │
   │                           │           3. createAnswer()│
   │◄──── SDP answer ─────────│◄──── SDP answer ──────────│
   │                           │                           │
   │ 4. ICE candidate ────────►│──── ICE candidate ───────►│
   │◄──── ICE candidate ──────│◄──── ICE candidate ───────│
   │     (trickle ICE - candidates sent as discovered)     │
   │                           │                           │
   │ 5. ICE connectivity checks (STUN binding requests)   │
   │◄─────────────────────────────────────────────────────►│
   │                           │                           │
   │ 6. DTLS handshake                                     │
   │◄─────────────────────────────────────────────────────►│
   │     (certificate exchange, cipher negotiation)        │
   │                           │                           │
   │ 7. SCTP association                                   │
   │◄─────────────────────────────────────────────────────►│
   │                           │                           │
   │ 8. Data Channel open                                  │
   │◄════════════ encrypted data flow ════════════════════►│
   │                           │                           │
   │     Signaling server no longer needed                 │
```

**Typical timing:**
- Steps 1-4 (signaling): 100-500ms
- Step 5 (ICE): 50-500ms (depends on NAT type)
- Step 6 (DTLS): 50-200ms
- Steps 7-8 (SCTP): ~10ms
- **Total: 200ms to 1.2s** for connection establishment

---

## WebRTC in Node.js

WebRTC was designed for browsers, where the APIs (`RTCPeerConnection`, `RTCDataChannel`) are built in. In Node.js, there is no built-in WebRTC implementation.

### Options for Node.js WebRTC

| Library | Status | Notes |
|---|---|---|
| **node-datachannel** | Active, maintained | Wraps libdatachannel (C++). Lightweight — only Data Channels, no media. Good fit for ChatterMatter. |
| **wrtc** | Unmaintained since 2022 | Was the standard choice. Wraps Google's libwebrtc. Heavy (media support included). Compatibility issues with Node 20+. |
| **werift** | Active | Pure TypeScript implementation. No native dependencies. Slower but portable. |

### Why ChatterMatter Phase 1 Uses WebSocket Instead

For CLI-only P2P Phase 1, WebSocket transport was chosen over WebRTC because:

1. **No native dependencies**: WebRTC in Node.js requires a C++ binding (node-datachannel) or an unmaintained package (wrtc). WebSocket (`ws` package) is pure JavaScript.

2. **Simpler setup**: WebRTC needs a signaling server even to connect two local terminals. WebSocket just needs a port number.

3. **Same CRDT layer**: Yjs is transport-agnostic. The `sync.ts` bridge, `validation.ts`, and `presence.ts` modules work identically regardless of whether data arrives via WebSocket or WebRTC Data Channel.

4. **WebRTC added later**: When the web app (Phase 2) arrives, WebRTC becomes essential — browsers have it natively. The plan is to support both transports, with WebSocket as the fallback per the design doc.

The transport swap is isolated to the connection layer. All application logic (CRDT sync, validation, presence, materialization) is transport-agnostic.

---

## WebRTC and CRDTs — Why They Pair Well

CRDTs (Conflict-free Replicated Data Types) and WebRTC are complementary:

| WebRTC provides | CRDTs provide |
|---|---|
| Direct peer-to-peer transport | Automatic conflict resolution |
| Low-latency delivery | Offline operation + eventual consistency |
| Binary message support | Compact binary sync protocol |
| Connection state management | Application state management |

In the ChatterMatter architecture:

```
┌─────────────────────────────────────────┐
│  ChatterMatter Blocks                   │
│  (JSON objects with id, type, content)  │
├─────────────────────────────────────────┤
│  Yjs CRDT Layer                         │
│  (Y.Map keyed by block ID)             │
│  — merge concurrent additions           │
│  — last-writer-wins for mutations       │
│  — binary sync protocol                 │
├─────────────────────────────────────────┤
│  Transport (WebRTC or WebSocket)        │
│  — delivers Yjs updates between peers   │
│  — encrypted (DTLS or TLS)             │
│  — connection management                │
└─────────────────────────────────────────┘
```

The CRDT layer doesn't care how its binary updates are delivered. The transport layer doesn't care what the bytes mean. This separation is what lets ChatterMatter start with WebSocket and add WebRTC without changing any application logic.

---

## Security Considerations for ChatterMatter

### What WebRTC Gives for Free

- **Transport encryption (DTLS)**: All data encrypted in transit, always
- **Certificate pinning via SDP**: MITM attacks prevented by fingerprint verification
- **No server in the data path**: The signaling server never sees document content

### What ChatterMatter Must Add

- **Session authentication**: WebRTC doesn't authenticate peers at the application level. ChatterMatter uses session tokens exchanged during signaling.
- **Authorization**: The master validates all operations (the `MasterValidator` class). WebRTC doesn't know about block permissions.
- **Signaling server trust**: The signaling server could theoretically inject a malicious peer's SDP. Mitigations: use a trusted/self-hosted signaling server, or verify peer identity out-of-band.

### Threat Model

| Threat | Mitigation |
|---|---|
| Eavesdropping on data | DTLS encryption (automatic) |
| Man-in-the-middle | SDP fingerprint verification |
| Malicious peer sends bad data | Master validation layer rejects invalid blocks |
| Spam/DoS from a peer | Rate limiting in MasterValidator |
| Signaling server compromise | Server never sees data; worst case is connection disruption |
| Rogue master | Out of scope for Phase 1; trust model assumes master is the document owner |

---

## Glossary

| Term | Definition |
|---|---|
| **ICE** | Interactive Connectivity Establishment — framework for NAT traversal |
| **STUN** | Session Traversal Utilities for NAT — discovers public IP:port |
| **TURN** | Traversal Using Relays around NAT — relays data when direct connection fails |
| **DTLS** | Datagram TLS — encryption for UDP-based protocols |
| **SCTP** | Stream Control Transmission Protocol — multiplexed, reliable/unreliable message delivery |
| **SDP** | Session Description Protocol — text format describing connection parameters |
| **Data Channel** | WebRTC API for arbitrary peer-to-peer data exchange |
| **Signaling** | Out-of-band exchange of SDP and ICE candidates to bootstrap a connection |
| **Trickle ICE** | Optimization: send ICE candidates as they're discovered instead of waiting for all |
| **NAT** | Network Address Translation — maps private IPs to public IPs |
| **Candidate** | A potential network address (host, server-reflexive, or relay) a peer can be reached at |
| **srflx** | Server-reflexive candidate — the public IP:port discovered via STUN |
