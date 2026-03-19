# ChatterMatter VS Code Extension — Development Guide

## Building

```bash
cd vscode-extension
npm install
npm run build
```

## Running in Debug Mode

Press `F5` in VS Code to launch the Extension Development Host with the extension loaded.

## P2P Networking

### Current Implementation

The extension uses **WebSocket** for P2P connections in a star topology:
- Owner hosts a WebSocket server on a configurable port (default: 4117)
- Clients connect via `ws://hostname:port`
- All data flows through the owner (hub-and-spoke model)

### Corporate Network Connectivity

| Scenario | What's Needed |
|----------|---------------|
| Same LAN | Host shares internal IP: `ws://192.168.1.50:4117` |
| Same VPN | Same as LAN — use VPN-assigned IP |
| Different subnets | Firewall must allow inbound on the port |
| Remote (no VPN) | Port forwarding required, or use a relay server |

**Finding your IP address:**
```bash
# macOS/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig | findstr "IPv4"
```

### Firewall Configuration (Host/Owner Only)

The owner's machine must accept inbound connections on the chosen port. Peers making outbound connections typically don't need firewall changes.

#### macOS

macOS will prompt automatically when the extension tries to listen. Click "Allow" when prompted.

To manually allow (if you dismissed the prompt):
```bash
# Check if firewall is enabled
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Add VS Code to allowed apps
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /Applications/Visual\ Studio\ Code.app

# Or disable firewall temporarily for testing
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off
```

#### Windows

Option 1: Allow through Windows Defender Firewall UI
1. Open "Windows Defender Firewall with Advanced Security"
2. Click "Inbound Rules" → "New Rule..."
3. Select "Port" → Next
4. Select "TCP" and enter port `4117` (or your chosen port)
5. Select "Allow the connection" → Next
6. Check all profiles (Domain, Private, Public) → Next
7. Name it "ChatterMatter P2P" → Finish

Option 2: PowerShell (run as Administrator)
```powershell
# Allow inbound on port 4117
New-NetFirewallRule -DisplayName "ChatterMatter P2P" -Direction Inbound -Protocol TCP -LocalPort 4117 -Action Allow

# To remove later
Remove-NetFirewallRule -DisplayName "ChatterMatter P2P"
```

#### Linux

**Ubuntu/Debian (ufw):**
```bash
# Check status
sudo ufw status

# Allow port 4117
sudo ufw allow 4117/tcp

# To remove later
sudo ufw delete allow 4117/tcp
```

**RHEL/CentOS/Fedora (firewalld):**
```bash
# Allow port 4117
sudo firewall-cmd --add-port=4117/tcp --permanent
sudo firewall-cmd --reload

# To remove later
sudo firewall-cmd --remove-port=4117/tcp --permanent
sudo firewall-cmd --reload
```

**iptables (manual):**
```bash
# Allow port 4117
sudo iptables -A INPUT -p tcp --dport 4117 -j ACCEPT

# Save rules (varies by distro)
sudo iptables-save > /etc/iptables/rules.v4
```

### Corporate Firewall Notes

- Corporate firewalls may block non-standard ports regardless of local settings
- If port 4117 is blocked, try common ports: 8080, 3000, 5000, 8443
- Some corporate networks require VPN for internal connectivity
- Contact IT if you need a port opened on corporate infrastructure

### Current Limitations

- **No NAT traversal:** Requires direct network path or VPN
- **No TLS:** Uses `ws://` not `wss://` (data is unencrypted)
- **No discovery:** Must manually share connection URLs
- **Single owner:** No failover if owner disconnects

### Future: WebRTC

WebRTC would enable:
- NAT traversal via ICE/STUN/TURN
- Encrypted connections by default (DTLS)
- Better P2P without central infrastructure

See `align/features/p2p-master-client.md` for the full architecture design.

## Testing P2P Collaboration

Testing P2P features requires two VS Code instances, each running their own Extension Development Host. macOS makes this tricky because VS Code normally reuses existing windows.

### Solution: Separate User Data Directories

Use `--user-data-dir` to launch a completely independent VS Code instance:

```bash
# Terminal 1 — Primary instance
code /Users/brad/git/ChatterMatter/vscode-extension

# Terminal 2 — Secondary instance with isolated profile
code --user-data-dir /tmp/vscode-test /Users/brad/git/ChatterMatter/vscode-extension
```

The second instance runs with its own isolated settings/state, so it's treated as a completely independent VS Code process. Both can run their own Extension Development Host (F5).

### Alternative: VS Code Insiders

If you have VS Code Insiders installed, use it as the second instance:

```bash
# Regular VS Code
code /Users/brad/git/ChatterMatter/vscode-extension

# VS Code Insiders
code-insiders /Users/brad/git/ChatterMatter/vscode-extension
```

### P2P Test Flow

1. **Host instance:**
   - Open a `.md` file
   - Click the broadcast icon in the editor title bar (or run "ChatterMatter: Host Review Session")
   - Note the port (default 4117)

2. **Peer instance:**
   - Run "ChatterMatter: Join Review Session"
   - Enter `ws://localhost:4117`
   - The Review Panel opens with the shared document

3. **Verify sync:**
   - Add comments from either side
   - Comments should appear on both instances in real-time

## Packaging

To create a `.vsix` package for distribution:

```bash
npm run package
```

Install the packaged extension via: Extensions > ... > Install from VSIX
