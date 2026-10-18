# Task ID: 20

**Title:** Hardware Bridge: Arm Path Planner and Web Serial Connection

**Status:** pending

**Dependencies:** 19

**Priority:** medium

**Description:** Build the bridge between the palm scene chart operations and the physical arm, including path planning (chart ops to serial commands) and Web Serial API connection. Ensure on-screen and physical arm move in sync.

**Details:**

Arm bridge implementation:
1. Create bridge/serial/ module with planner.ts and webserial.ts
2. Implement planner.ts to convert chart operations to serial commands:
   - Input: ChartOps {points: number[], taps: number[], pauses: number[]}
   - Output: string[] of serial commands
   - Algorithm:
     - H (home and lift)
     - For each stroke (series of connected points):
       - P0 (pen up)
       - M x y (move to first point)
       - P1 (pen down)
       - For each subsequent point: M x y
       - P0 (pen up)
     - For each tap marker:
       - P0, M x y (move to tap position)
       - T 200 (tap for 200ms)
     - W 500 (wait before next operation)
   - Normalize points from [0, 1] to drawing box coordinates
   - Cap speed at 4 cm/s by inserting intermediate waypoints if needed
3. Implement webserial.ts for Web Serial API:
   - connectArm() function to request port and connect at 115200 baud
   - disconnectArm() function
   - send(commands: string[]) function that:
     - Sends each command
     - Waits for OK or ERR response
     - Logs errors
     - Returns success/failure status
   - Monitor connection status (connected/disconnected)
4. Integrate with palm scene:
   - When chart operations are sent to palm scene:
     - If arm is connected, also send to physical arm via bridge
     - On-screen animation and physical drawing start simultaneously
     - Track sync: physical should be within 200ms of on-screen
5. Handle connection errors gracefully:
   - If send fails, mark arm as disconnected
   - Show notification: "Palm arm disconnected"
   - Continue with on-screen visualization only
   - Sonification automatically activates (from task 17)
6. Settings integration:
   - Settings menu has "Palm arm: Connect / Disconnect" option
   - Connect triggers Web Serial port picker
   - Disconnect closes serial port
   - Store connection preference in localStorage
7. Permissions:
   - Web Serial requires HTTPS or localhost
   - User gesture required to request port
8. Telemetry (optional, stretch):
   - Receive position updates from arm
   - Display on palm scene for debugging

Planner pseudo-code:
function plan(chartOps: ChartOps): string[] {
  const commands: string[] = ['H']; // home
  
  // Draw main series
  if (chartOps.points.length > 0) {
    commands.push('P0'); // pen up
    commands.push(`M ${chartOps.points[0].x} ${chartOps.points[0].y}`);
    commands.push('P1'); // pen down
    
    for (let i = 1; i < chartOps.points.length; i++) {
      commands.push(`M ${chartOps.points[i].x} ${chartOps.points[i].y}`);
    }
    
    commands.push('P0'); // pen up
  }
  
  // Add taps
  for (const tap of chartOps.taps) {
    commands.push(`M ${tap.x} ${tap.y}`);
    commands.push('T 200'); // tap for 200ms
  }
  
  return commands;
}

Cross-team dependencies:
- Task 16 in the frontend tag: Chart Output: Realistic Palm Scene with Hand, Arm IK, and Animated Trace

**Test Strategy:**

Integration test: Connect to simulated serial device (virtual port or mock), send 12-point line commands, verify command sequence. Bench test with real hardware: Draw lesson 1 chart, record video of on-screen and physical arm side-by-side, verify sync within 200ms. Test disconnect during drawing: verify graceful fallback to on-screen only. Test connection in settings menu: verify port picker opens. Unit test planner with known chart ops, verify command sequence is correct.
