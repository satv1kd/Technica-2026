// Sonar palm arm: an ESP32 two-link arm that draws charts on the learner's palm.
//
// Board: any ESP32 dev board. Library: ESP32Servo (Library Manager).
// Wiring: shoulder servo on GPIO 18, elbow on 19, stylus lift on 21, all
// powered from a separate 5 V supply with a common ground.
//
// Speaks the line protocol in protocol.h at 115200 baud. Each command is
// answered with "OK" once the motion has finished, so the bridge never gets
// ahead of the arm. Safety rules, enforced here regardless of what is sent:
//   - pressure never exceeds level 5 (F 6 is rejected),
//   - the stylus lifts after 3 s without a command,
//   - an invalid command lifts the stylus before answering ERR,
//   - targets outside the reachable box are rejected, never clipped,
//   - a watchdog resets the board if the loop hangs.
#include <ESP32Servo.h>
#include <esp_task_wdt.h>

#include "ik.h"
#include "motion.h"
#include "protocol.h"

// Pins and servo calibration. Adjust the lift angles on your build so that
// level 1 just touches the skin.
const int PIN_SHOULDER = 18, PIN_ELBOW = 19, PIN_LIFT = 21;
const int SERVO_MIN_US = 500, SERVO_MAX_US = 2500;  // 0 and 180 degrees
const float LIFT_UP_DEG = 100.0f;
const float LIFT_TOUCH_DEG = 82.0f;     // pressure level 1
const float LIFT_PER_LEVEL_DEG = 3.0f;  // each level presses a little further

const unsigned long BAUD = 115200;
const unsigned long AUTO_LIFT_MS = 3000;
const unsigned long PRESS_MS = 120;  // stylus up/down time, same as the on-screen arm
const unsigned long TICK_MS = 10;    // motion update period
const int WATCHDOG_S = 5;
const ik::Point HOME_UNIT = {1.1f, 0.5f};  // just right of the box, like the on-screen arm

Servo shoulderServo, elbowServo, liftServo;
ik::Point pos;  // current stylus position, cm
bool penDown = false;
int force = 3;
unsigned long lastCommandMs = 0;

char line[48];
size_t lineLen = 0;
bool lineOverflow = false;

void feedWatchdog() { esp_task_wdt_reset(); }

int degToUs(float deg) {
  if (deg < 0) deg = 0;
  if (deg > 180) deg = 180;
  return SERVO_MIN_US + (int)(deg / 180.0f * (SERVO_MAX_US - SERVO_MIN_US));
}

void writeJoints(const ik::Joints& j) {
  shoulderServo.writeMicroseconds(degToUs(j.shoulder * ik::DEG));
  elbowServo.writeMicroseconds(degToUs(j.elbow * ik::DEG));
}

void waitMs(unsigned long ms) {
  const unsigned long start = millis();
  while (millis() - start < ms) {
    feedWatchdog();
    delay(ms - (millis() - start) > TICK_MS ? TICK_MS : ms - (millis() - start));
  }
}

void setPen(bool down) {
  if (down == penDown) return;
  const float deg = down ? LIFT_TOUCH_DEG - (force - 1) * LIFT_PER_LEVEL_DEG : LIFT_UP_DEG;
  liftServo.writeMicroseconds(degToUs(deg));
  penDown = down;
  waitMs(PRESS_MS);
}

// Straight-line move in the palm plane, timed by the trapezoid profile.
// Solves IK every tick so the stylus follows the line, not a joint-space arc.
bool moveTo(ik::Point target) {
  ik::Joints j;
  if (!ik::solve(target, j)) return false;
  const ik::Point from = pos;
  const float dist = hypotf(target.x - from.x, target.y - from.y);
  const motion::Trapezoid prof(dist);
  const unsigned long start = millis();
  for (;;) {
    const float t = (millis() - start) / 1000.0f;
    const float f = prof.at(t);
    const ik::Point p = {from.x + (target.x - from.x) * f, from.y + (target.y - from.y) * f};
    if (!ik::solve(p, j)) {
      setPen(false);
      return false;
    }
    writeJoints(j);
    pos = p;
    if (t >= prof.duration) break;
    feedWatchdog();
    delay(TICK_MS);
  }
  pos = target;
  return true;
}

void home() {
  setPen(false);
  moveTo(ik::boxToCm(HOME_UNIT.x, HOME_UNIT.y));
}

// Returns the reply line for one command.
const char* execute(const protocol::Command& c) {
  switch (c.kind) {
    case protocol::HOME:
      home();
      return "OK";
    case protocol::PEN:
      setPen(c.value == 1);
      return "OK";
    case protocol::MOVE:
      return moveTo(ik::boxToCm(c.x, c.y)) ? "OK" : "ERR_LIMIT";
    case protocol::TAP: {
      const bool wasDown = penDown;
      setPen(true);
      waitMs(c.value);
      if (!wasDown) setPen(false);
      return "OK";
    }
    case protocol::WAIT:
      // Never hold pressure longer than the auto-lift limit.
      if (penDown && (unsigned long)c.value > AUTO_LIFT_MS) setPen(false);
      waitMs(c.value);
      return "OK";
    case protocol::FORCE:
      force = c.value;  // already capped at MAX_FORCE by the parser
      return "OK";
    case protocol::INVALID:
    default:
      setPen(false);  // emergency stop: lift first, then report
      return c.error ? c.error : "ERR_PARSE";
  }
}

void handleLine() {
  if (lineOverflow) {
    setPen(false);
    Serial.println("ERR_PARSE");
  } else if (lineLen > 0) {
    line[lineLen] = '\0';
    Serial.println(execute(protocol::parse(line)));
  }
  lineLen = 0;
  lineOverflow = false;
  lastCommandMs = millis();
}

void setup() {
  Serial.begin(BAUD);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  const esp_task_wdt_config_t wdt = {.timeout_ms = WATCHDOG_S * 1000, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&wdt);
#else
  esp_task_wdt_init(WATCHDOG_S, true);
#endif
  esp_task_wdt_add(NULL);

  shoulderServo.attach(PIN_SHOULDER, SERVO_MIN_US, SERVO_MAX_US);
  elbowServo.attach(PIN_ELBOW, SERVO_MIN_US, SERVO_MAX_US);
  liftServo.attach(PIN_LIFT, SERVO_MIN_US, SERVO_MAX_US);

  // Lift first, then jump straight to home: position is unknown at power-on.
  penDown = true;
  setPen(false);
  pos = ik::boxToCm(HOME_UNIT.x, HOME_UNIT.y);
  ik::Joints j;
  if (ik::solve(pos, j)) writeJoints(j);
  waitMs(500);
  lastCommandMs = millis();
  Serial.println("READY");
}

void loop() {
  feedWatchdog();
  while (Serial.available()) {
    const char ch = (char)Serial.read();
    if (ch == '\n') {
      handleLine();
    } else if (ch != '\r') {
      if (lineLen < sizeof(line) - 1) line[lineLen++] = ch;
      else lineOverflow = true;
    }
  }
  if (penDown && millis() - lastCommandMs > AUTO_LIFT_MS) setPen(false);
}
