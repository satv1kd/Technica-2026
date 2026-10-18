# Palm arm firmware

ESP32 firmware for the two-link arm that draws charts on the learner's palm.
It mirrors the on-screen arm in `frontend/web/lib/palm/motion.ts`: same link
lengths (9 cm and 8 cm), the same 6 x 4 cm drawing box, the same inverse
kinematics, and the same 4 cm/s speed limit. A drawing therefore takes the same
time on the palm as it does on screen.

## Build and upload

1. Install the Arduino IDE (or `arduino-cli`) with the **esp32** board package.
2. Install the **ESP32Servo** library from the Library Manager.
3. Open `palm_arm.ino`, pick your ESP32 board and port, and upload.
4. In the Serial Monitor at 115200 baud, newline line endings, you should see
   `READY`. Type `M 0.5 0.5` and the arm moves to the middle of the box.

Wiring: shoulder servo on GPIO 18, elbow on GPIO 19, stylus lift on GPIO 21.
Power the servos from a separate 5 V supply and share ground with the ESP32.
Calibrate `LIFT_UP_DEG` and `LIFT_TOUCH_DEG` so that pressure level 1 just
touches the skin. Use a soft, inkless stylus.

## Protocol

One command per line. The arm answers `OK` once the motion is finished, or
`ERR_<CODE>`.

| Command | Meaning |
| --- | --- |
| `H` | Lift the stylus and go home |
| `P0` / `P1` | Stylus up / down |
| `M x y` | Move in a straight line to x, y in [0, 1] (x: past to today, y: low to high) |
| `T ms` | Tap for 1 to 1000 ms |
| `W ms` | Wait 0 to 5000 ms |
| `F n` | Pressure level 1 to 5 |

Errors: `ERR_PARSE` (malformed), `ERR_RANGE` (value out of range),
`ERR_LIMIT` (target unreachable), `ERR_UNKNOWN` (unknown command).

## Safety

These rules are enforced in firmware, whatever the computer sends:

- Pressure can't exceed level 5. `F 6` is rejected.
- The stylus lifts after 3 seconds without a command, and before any wait
  longer than that.
- An invalid command lifts the stylus before the error is sent.
- Unreachable targets are rejected, never clipped.
- A 5-second watchdog resets the board if the firmware hangs.

## Tests

IK, the motion profile, and the parser are plain C++ and run on any computer:

```bash
npm run test:firmware
```

The expected IK angles and move times come from `motion.ts`, so a passing run
means the physical arm and the on-screen arm agree.
