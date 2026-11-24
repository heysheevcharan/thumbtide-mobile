/**
 * Each game describes its message shapes once and gets typed Host/Controller APIs:
 *
 *   interface MyGame {
 *     toHost: { type: "jump" } | { type: "vote"; choice: number };
 *     toController: { type: "buzz" };
 *     input: { x: number; y: number };
 *     shared: { phase: "lobby" | "playing" };
 *     own: { color: string };
 *   }
 *   const host = new Host<MyGame>({ ... });
 */
export interface GameMessages {
  /** Discrete events from phone → screen (button presses, votes). */
  toHost: unknown;
  /** Discrete events from screen → phone (buzz, show toast). */
  toController: unknown;
  /** Continuous, latest-wins input (joystick, tilt). Sent at a capped rate. */
  input: unknown;
  /** Sticky state every controller sees. */
  shared: unknown;
  /** Sticky state for one player. */
  own: unknown;
}

export interface AnyGame extends GameMessages {
  toHost: any;
  toController: any;
  input: any;
  shared: any;
  own: any;
}
