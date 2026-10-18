# Task ID: 19

**Title:** Hardware: ESP32 Firmware with Inverse Kinematics, Motion Control, and Safety

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Develop ESP32 firmware for the palm arm with on-device inverse kinematics, trapezoidal velocity profile, serial protocol handling, and safety limits including auto-lift and pressure constraints.

**Details:**

Firmware implementation:
1. Create firmware/palm-arm/ directory with Arduino C++ code
2. File structure:
   - palm_arm.ino (main loop and serial handling)
   - ik.h (inverse kinematics solver)
   - motion.h (trapezoidal velocity profile)
   - protocol.h (serial command parsing)
3. Implement IK solver on ESP32:
   - Same algorithm as in palm scene (task 16)
   - Calculate shoulder and elbow angles from target (x, y)
   - Apply joint angle soft limits: shoulder [0°, 180°], elbow [0°, 135°]
   - Reject targets outside reachable workspace
4. Implement trapezoidal velocity profile:
   - Acceleration phase: linear ramp up
   - Constant velocity phase: max 4 cm/s
   - Deceleration phase: linear ramp down
   - Prevents jerky motion and reduces stress on servos
5. Implement serial protocol (115200 baud):
   - Commands from bridge:
     - H: home position and lift pen
     - P0: pen up (lift servo to raised position)
     - P1: pen down (lift servo presses gently)
     - M x y: move to position (x, y in [0, 1] normalized coords)
     - T ms: tap for specified duration
     - W ms: wait/pause for specified duration
     - F n: set force level 1-5 (1=lightest, 5=max allowed)
   - Responses to computer:
     - OK: command succeeded
     - ERR code: command failed (e.g., ERR_TIMEOUT, ERR_LIMIT)
6. Implement safety features:
   - Maximum pressure level 5 enforced in firmware (cannot be exceeded)
   - Auto-lift after 3 seconds of no commands (prevents prolonged pressure)
   - Soft inkless stylus (hardware choice)
   - Emergency stop on invalid commands
7. Map normalized coordinates to physical workspace:
   - Drawing box: 6cm x 4cm on palm
   - Origin at top-left of box
   - Apply workspace-to-joint transformation
8. Servo control:
   - 3 servos: shoulder joint, elbow joint, pen lift
   - Use Servo.h library or ESP32 LEDC for PWM
   - Smooth interpolation between positions
9. Startup behavior:
   - Home all servos to known position
   - Lift pen
   - Send ready signal over serial
10. Error handling:
    - Watchdog timer for firmware hangs
    - Return ERR codes for invalid positions, timeouts

Arduino pseudo-code:
#include <Servo.h>
#include "ik.h"
#include "motion.h"
#include "protocol.h"

Servo shoulder, elbow, lift;
void setup() {
  Serial.begin(115200);
  shoulder.attach(SHOULDER_PIN);
  elbow.attach(ELBOW_PIN);
  lift.attach(LIFT_PIN);
  home();
  Serial.println("OK");
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    handleCommand(cmd);
  }
  checkAutoLift(); // lift after 3s idle
}

void handleCommand(String cmd) {
  if (cmd[0] == 'M') {
    float x, y;
    sscanf(cmd.c_str(), "M %f %f", &x, &y);
    auto angles = solveIK(x * 60, y * 40); // mm
    moveTo(angles.shoulder, angles.elbow);
    Serial.println("OK");
  }
  // ... other commands
}

**Test Strategy:**

Bench test with ruler: Send M commands for a 12-point line, measure actual drawing is within 2mm of 6x4cm box. Test auto-lift: send M command, wait 3s, verify pen lifts. Test pressure: set F 5, verify stylus doesn't press too hard (subjective feel). Test homing: power cycle, verify arm returns to known position. Test serial protocol: send H, P0, M 0.5 0.5, P1, P0 sequence, verify each returns OK. Test invalid command returns ERR. Measure max speed doesn't exceed 4 cm/s.
