# Build from source: mDNS peer discovery fails on Mac Studio cluster (macOS Tahoe 26.3)

## Environment
- 4 x Mac Studio (M2 Ultra), macOS 26.3.1 (Tahoe), build 25D2128
- exo v1.0.68 built from source (`git checkout v1.0.68`, `uv sync`, `uv run maturin develop --release`)
- Python 3.13.12 (via uv), uv 0.10.7
- Network: all on same 192.168.86.0/24 subnet via Ethernet (Google Nest WiFi router)
- **The .dmg app v1.0.68 works perfectly** — 4-node cluster forms immediately

## Symptom
When running `uv run exo`, each node elects itself Master independently. No peers are ever discovered. The `handle_mdns_discovered()` callback (in `discovery.rs`) is never invoked.

## Investigation & Root Cause

### What works
- Raw UDP multicast between machines: verified with custom Python sender/receiver test ✅
- `dns-sd -B _exo._tcp` sees the .dmg app's mDNS services ✅
- libp2p-mdns DOES send `_p2p._udp` mDNS query packets (verified with packet sniffer on same machine) ✅
- The Rust networking task starts correctly (`"RUST: networking task started"`) ✅
- `NetworkingHandle` and all pyo3 bindings work ✅
- Rust bindings compile and link correctly ✅

### What fails
- `mdns::Event::Discovered` is **never emitted** between machines ❌
- No dial attempts, no connection events, no errors ❌
- `if_watch::IfEvent::Up` events appear to never fire in the mDNS `Behaviour::poll()` ❌

### Root Cause: `if_watch` + tokio runtime + macOS multi-interface

We instrumented `libp2p-mdns v0.48.0` `behaviour.rs` with `eprintln!()` inside the `IfEvent::Up` handler. After 30 seconds of runtime, **zero** `IfEvent::Up` events were observed. The `if_watch` crate's `IfWatcher` (tokio variant) appears to not function correctly under the pyo3-async-runtimes tokio runtime on macOS 26.3.

Each Mac Studio has 42 network interfaces (6 Thunderbolt bridges + anpi + en + bridge + ap + llw...) with 4 active non-loopback IPv4 addresses:
```
169.254.212.114  (en3, Thunderbolt bridge, link-local)
169.254.93.17    (en4, Thunderbolt bridge, link-local)
192.168.86.29    (en0, Ethernet LAN)
169.254.135.40   (en14, Thunderbolt bridge, link-local)
```

Additionally, macOS's `mDNSResponder` daemon binds to `UDP *.5353` — with `SO_REUSEPORT`, it competes for incoming mDNS packets with any user-space socket on port 5353.

### Why the .dmg app works
The .dmg app likely uses macOS's native Bonjour/dns-sd API (which goes through `mDNSResponder`) rather than raw UDP sockets, avoiding both the `if_watch` issue and `SO_REUSEPORT` contention.

### Why it may work for @AlexCheema
Possibly fewer interfaces (no Thunderbolt bridges), different macOS version, or different tokio runtime behavior. The key differentiator appears to be whether `if_watch` successfully produces `IfEvent::Up` events.

## Patches Attempted (none resolved the issue)

### 1. Filter link-local addresses in libp2p-mdns
Added code in `behaviour.rs` to skip `169.254.x.x` addresses → reduced from 4 to 1 InterfaceState, but `if_watch` still never fired events.

### 2. EXO_BIND_IP environment variable
Patched `swarm.rs` to listen only on a specific IP and `behaviour.rs` to only create InterfaceState for matching IP → swarm correctly used the env var, but `if_watch` still never fired.

## Steps to Reproduce
1. Use a Mac Studio (or any Mac with Thunderbolt bridges) running macOS Tahoe (26.x)
2. Clone exo, checkout v1.0.68, build from source
3. Run `uv run exo --verbose` on 2+ machines on same LAN
4. Observe: each node elects itself Master, no peers discovered
5. Verify mDNS packets ARE sent: sniff port 5353 on the same machine → `_p2p` packets visible
6. Instrument `behaviour.rs` `IfEvent::Up` handler → never called

## Suggested Fixes

### Option A: Use platform-native mDNS on macOS
Use `dns-sd` / Bonjour API on macOS instead of `libp2p-mdns` raw sockets. This is what the .dmg app appears to do.

### Option B: Investigate `if_watch` + pyo3 tokio runtime
The `if_watch` `IfWatcher::new()` may require specific tokio runtime configuration or permissions that the pyo3-async-runtimes tokio runtime doesn't provide.

### Option C: Add manual peer specification
Support `--peer 192.168.86.30:PORT` CLI flag as fallback when mDNS doesn't work.

## Workaround
Use the .dmg app instead of building from source.
