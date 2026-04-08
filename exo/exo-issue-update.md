## Root Cause Found: link-local interfaces starving mDNS

### Setup
- 4 × Mac Studio (macOS 26.3.1 Tahoe), Python 3.13, build from source v1.0.68
- Each Mac Studio has **4 non-loopback IPv4 addresses**: 1 × 192.168.86.x (en0 Ethernet) + 3 × 169.254.x.x (Thunderbolt link-local)

### Investigation
1. Raw multicast between machines works ✅
2. libp2p-mdns sends _p2p mDNS queries ✅ (verified with packet sniffer)
3. `handle_mdns_discovered()` is **never called** ❌

### Root Cause
`libp2p-mdns` creates one `InterfaceState` per non-loopback IPv4 address (via if-watch). Each `InterfaceState` creates a recv socket bound to `0.0.0.0:5353` with `SO_REUSEPORT`.

With 4 sockets on port 5353, macOS distributes incoming mDNS packets across all sockets using SO_REUSEPORT load balancing. 3 out of 4 sockets belong to 169.254.x.x (link-local/Thunderbolt) interfaces. These interfaces cannot reach the LAN, so:
- **Queries sent from en0 get responses** that are then delivered to a random socket
- **75% of responses go to a Thunderbolt socket** where they are processed but the discovered peer multiaddr is unreachable
- The en0 socket **rarely receives the response** it needs

The .dmg app likely works because it may filter interfaces or use a different mDNS implementation.

### Suggested Fix
In `behaviour.rs`, skip link-local addresses (169.254.0.0/16) when creating InterfaceState:

```rust
Ok(IfEvent::Up(inet)) => {
    let addr = inet.addr();
    if addr.is_loopback() {
        continue;
    }
    // Skip link-local addresses
    if let IpAddr::V4(v4) = addr {
        if v4.is_link_local() {
            continue;
        }
    }
    // ... rest of the code
}
```

Alternatively, filter in the exo discovery.rs wrapper.
