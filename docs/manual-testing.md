# Manual test checklist

Use current Chrome or Edge on Windows 10/11. Open developer tools in the host and viewer tabs to inspect errors. Do not include room invites or host tokens in public bug reports.

| Scenario | Action | Expected result |
| --- | --- | --- |
| Tab capture | Create a room, select **Share screen**, choose a browser tab, and enable tab audio if offered. | Local preview and remote video appear. If audio was captured, the host mute button is enabled. |
| Display capture | Stop, then share an entire display. | Preview and remote video appear; system audio may be unavailable. |
| Window or game | Share a window or game. | Video appears remotely; protected or exclusive fullscreen content may fail. |
| Two to five viewers | Open the same invite in separate private browser profiles. | Each viewer receives a stream; a sixth viewer is rejected. |
| Late join | Start streaming before the viewer joins. | The new viewer receives video without restarting capture. |
| Reconnect | Briefly disconnect and reconnect a viewer's network. | Socket.IO reconnects and peers renegotiate while the ticket remains valid. |
| Stop capture | Select **Stop stream**. | Local tracks stop and remote players return to a waiting state. |
| Close host tab | Close the host tab during a stream. | The server marks the room offline; viewers wait for the host. |
| Invalid room | Replace the 24-character room ID with a random one. | Joining returns a room-not-found error. |
| Viewer permissions | Open the invite as a viewer. | No host controls are shown, and forged host signaling is rejected by the server. |
| Capture canceled | Cancel the browser's share picker. | The UI reports the cancellation and does not show the room as live. |
| Cleanup | Join and leave repeatedly, then inspect `chrome://webrtc-internals`. | Old peer connections close and the host does not retain an unwanted capture. |
| Another network | Open the HTTPS invite from a different network. | The site and signaling load; configure TURN if ICE cannot connect media. |

For capture-to-display latency, film the source and viewer monitor in the same shot or display a clock in the captured source and compare frames. The RTT shown in the app does not measure this latency.
