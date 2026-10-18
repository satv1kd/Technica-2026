// Host tests for the firmware's pure logic (IK, motion profile, protocol).
//
//   npm run test:firmware
//
// The IK and profile values below come from frontend/web/lib/palm/motion.ts,
// so a pass means the physical arm and the on-screen arm agree.
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "ik.h"
#include "motion.h"
#include "protocol.h"

static int failures = 0, checks = 0;

#define CHECK(cond)                                                \
  do {                                                             \
    checks++;                                                      \
    if (!(cond)) {                                                 \
      failures++;                                                  \
      fprintf(stderr, "%s:%d: CHECK(%s) failed\n", __FILE__, __LINE__, #cond); \
    }                                                              \
  } while (0)

static bool near(float a, float b, float tol = 1e-4f) { return fabsf(a - b) <= tol; }

static void ik_matches_the_on_screen_arm() {
  // {u, v, shoulder, elbow} from solveIK(boxToCm(u, v)) in motion.ts.
  const float ref[][4] = {
      {0, 0, 1.952620f, 1.487366f},     {1, 0, 1.282893f, 2.193623f},
      {0, 1, 1.929062f, 1.014814f},     {1, 1, 1.246922f, 1.710136f},
      {0.5f, 0.5f, 1.577765f, 1.689128f}, {0.25f, 0.8f, 1.738998f, 1.361707f},
  };
  for (const auto& r : ref) {
    ik::Joints j;
    CHECK(ik::solve(ik::boxToCm(r[0], r[1]), j));
    CHECK(near(j.shoulder, r[2]));
    CHECK(near(j.elbow, r[3]));
  }
}

static void ik_round_trips_across_the_whole_box() {
  for (int i = 0; i <= 20; i++) {
    for (int k = 0; k <= 20; k++) {
      const ik::Point p = ik::boxToCm(i / 20.0f, k / 20.0f);
      ik::Joints j;
      CHECK(ik::solve(p, j));
      const ik::Point back = ik::forward(j);
      CHECK(near(back.x, p.x, 1e-3f) && near(back.y, p.y, 1e-3f));
      CHECK(j.shoulder >= ik::SHOULDER_MIN && j.shoulder <= ik::SHOULDER_MAX);
      CHECK(j.elbow >= ik::ELBOW_MIN && j.elbow <= ik::ELBOW_MAX);
    }
  }
  // Home, just right of the box, is reachable too.
  ik::Joints j;
  CHECK(ik::solve(ik::boxToCm(1.1f, 0.5f), j));
}

static void ik_rejects_unreachable_targets() {
  ik::Joints j = {42, 42};
  CHECK(!ik::solve({30, 0}, j));     // beyond both links
  CHECK(!ik::solve({0.5f, 0}, j));   // too close: elbow would fold past its limit
  CHECK(!ik::solve({0, -16.5f}, j)); // below the shoulder: servo can't turn there
  CHECK(j.shoulder == 42 && j.elbow == 42);  // untouched on failure
}

static void trapezoid_matches_the_on_screen_timing() {
  // {dist, duration} from trapezoid(dist) in motion.ts.
  const float ref[][2] = {{0.1f, 0.158114f}, {0.5f, 0.353553f}, {1, 0.5f}, {6, 1.75f}, {7.2111f, 2.052775f}};
  for (const auto& r : ref) {
    const motion::Trapezoid t(r[0]);
    CHECK(near(t.duration, r[1]));
    CHECK(near(t.at(t.duration / 2), 0.5f));
    CHECK(t.at(0) == 0.0f && near(t.at(t.duration), 1.0f));
    CHECK(t.peakV <= motion::MAX_SPEED_CM_S + 1e-6f);
  }
  // Monotonic: the stylus never backs up.
  const motion::Trapezoid t(6);
  float last = 0;
  for (float s = 0; s <= t.duration; s += 0.01f) {
    CHECK(t.at(s) >= last);
    last = t.at(s);
  }
  CHECK(motion::Trapezoid(0).at(0) == 1.0f);
}

static void protocol_parses_what_the_planner_sends() {
  using namespace protocol;
  CHECK(parse("H").kind == HOME);
  CHECK(parse("P0").kind == PEN && parse("P0").value == 0);
  CHECK(parse("P1\r").kind == PEN && parse("P1").value == 1);
  Command m = parse("M 0.250 1.000");
  CHECK(m.kind == MOVE && near(m.x, 0.25f) && near(m.y, 1.0f));
  CHECK(parse("T 180").kind == TAP && parse("T 180").value == 180);
  CHECK(parse("W 500").kind == WAIT && parse("W 500").value == 500);
  CHECK(parse("W 0").kind == WAIT);
  CHECK(parse("F 3").kind == FORCE && parse("F 3").value == 3);
  CHECK(parse("  h  ").kind == HOME);
}

static void protocol_rejects_bad_and_unsafe_commands() {
  using namespace protocol;
  auto err = [](const char* s) { Command c = parse(s); return c.kind == INVALID ? c.error : "(valid)"; };
  CHECK(strcmp(err("F 6"), "ERR_RANGE") == 0);   // pressure cap
  CHECK(strcmp(err("F 0"), "ERR_RANGE") == 0);
  CHECK(strcmp(err("F 2.5"), "ERR_PARSE") == 0);
  CHECK(strcmp(err("M 1.2 0.5"), "ERR_RANGE") == 0);
  CHECK(strcmp(err("M -0.1 0.5"), "ERR_RANGE") == 0);
  CHECK(strcmp(err("M 0.5"), "ERR_PARSE") == 0);
  CHECK(strcmp(err("M 0.5 0.5 9"), "ERR_PARSE") == 0);
  CHECK(strcmp(err("M 0.5x 0.5"), "ERR_PARSE") == 0);
  CHECK(strcmp(err("T 5000"), "ERR_RANGE") == 0);
  CHECK(strcmp(err("W 60000"), "ERR_RANGE") == 0);
  CHECK(strcmp(err("P2"), "ERR_PARSE") == 0);
  CHECK(strcmp(err("H now"), "ERR_PARSE") == 0);
  CHECK(strcmp(err("Z"), "ERR_UNKNOWN") == 0);
  CHECK(strcmp(err(""), "ERR_PARSE") == 0);
}

int main() {
  ik_matches_the_on_screen_arm();
  ik_round_trips_across_the_whole_box();
  ik_rejects_unreachable_targets();
  trapezoid_matches_the_on_screen_timing();
  protocol_parses_what_the_planner_sends();
  protocol_rejects_bad_and_unsafe_commands();
  printf("%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
