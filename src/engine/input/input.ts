// ── Types ──────────────────────────────────────────────────────────

export interface ButtonState {
  down: boolean;
  justPressed: boolean;
  justReleased: boolean;
}

export interface KeyboardState {
  /** Set of key codes currently held down. */
  readonly held: ReadonlySet<string>;
  /** Set of key codes pressed this frame. */
  readonly justPressed: ReadonlySet<string>;
  /** Set of key codes released this frame. */
  readonly justReleased: ReadonlySet<string>;
}

export interface MouseState {
  /** X position in CSS pixels relative to target. */
  x: number;
  /** Y position in CSS pixels relative to target. */
  y: number;
  /** Accumulated horizontal movement delta since last poll. */
  dx: number;
  /** Accumulated vertical movement delta since last poll. */
  dy: number;
  /** Accumulated horizontal scroll delta since last poll. */
  scrollX: number;
  /** Accumulated vertical scroll delta since last poll. */
  scrollY: number;
  /** Button states (index 0 = left, 1 = middle, 2 = right). */
  buttons: readonly [ButtonState, ButtonState, ButtonState];
}

export interface GamepadButtonState {
  down: boolean;
  justPressed: boolean;
  justReleased: boolean;
  value: number;
}

export interface GamepadState {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly GamepadButtonState[];
}

// ── Internal accumulation types ────────────────────────────────────

interface KeyAccum {
  held: Set<string>;
  pressed: Set<string>;
  released: Set<string>;
}

interface MouseAccum {
  x: number;
  y: number;
  dx: number;
  dy: number;
  scrollX: number;
  scrollY: number;
  buttonsDown: [boolean, boolean, boolean];
  buttonsPressed: [boolean, boolean, boolean];
  buttonsReleased: [boolean, boolean, boolean];
}

// ── InputBinding ───────────────────────────────────────────────────

export class InputBinding {
  // ── Snapshotted state (read after poll()) ──
  private _keyboard: KeyboardState = {
    held: new Set(),
    justPressed: new Set(),
    justReleased: new Set(),
  };

  private _mouse: MouseState = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    scrollX: 0,
    scrollY: 0,
    buttons: [
      { down: false, justPressed: false, justReleased: false },
      { down: false, justPressed: false, justReleased: false },
      { down: false, justPressed: false, justReleased: false },
    ],
  };

  private _gamepads: Map<number, GamepadState> = new Map();
  private _prevGamepadButtons: Map<number, boolean[]> = new Map();

  // ── Accumulation state (written by handlers between polls) ──
  private _keyAccum: KeyAccum = {
    held: new Set(),
    pressed: new Set(),
    released: new Set(),
  };

  private _mouseAccum: MouseAccum = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    scrollX: 0,
    scrollY: 0,
    buttonsDown: [false, false, false],
    buttonsPressed: [false, false, false],
    buttonsReleased: [false, false, false],
  };

  // ── DOM references ──
  private _target: EventTarget | null = null;
  private _cleanups: (() => void)[] = [];

  // ── DOM event handlers (arrow functions for correct `this`) ──

  private _onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.repeat) return;
    this._keyAccum.held.add(ke.code);
    this._keyAccum.pressed.add(ke.code);
  };

  private _onKeyUp = (e: Event) => {
    const ke = e as KeyboardEvent;
    this._keyAccum.held.delete(ke.code);
    this._keyAccum.released.add(ke.code);
  };

  private _onBlur = () => {
    this._keyAccum.held.clear();
  };

  private _onMouseMove = (e: Event) => {
    const me = e as MouseEvent;
    this._mouseAccum.x = me.clientX;
    this._mouseAccum.y = me.clientY;
    this._mouseAccum.dx += me.movementX;
    this._mouseAccum.dy += me.movementY;
  };

  private _onMouseDown = (e: Event) => {
    const me = e as MouseEvent;
    const btn = me.button;
    if (btn >= 0 && btn < 3) {
      this._mouseAccum.buttonsDown[btn] = true;
      this._mouseAccum.buttonsPressed[btn] = true;
    }
  };

  private _onMouseUp = (e: Event) => {
    const me = e as MouseEvent;
    const btn = me.button;
    if (btn >= 0 && btn < 3) {
      this._mouseAccum.buttonsDown[btn] = false;
      this._mouseAccum.buttonsReleased[btn] = true;
    }
  };

  private _onWheel = (e: Event) => {
    const we = e as WheelEvent;
    this._mouseAccum.scrollX += we.deltaX;
    this._mouseAccum.scrollY += we.deltaY;
  };

  constructor(target?: EventTarget) {
    if (target) {
      this.attach(target);
    }
  }

  // ── Public query API ──

  get keyboard(): KeyboardState {
    return this._keyboard;
  }

  get mouse(): MouseState {
    return this._mouse;
  }

  isKeyDown(code: string): boolean {
    return this._keyboard.held.has(code);
  }

  isKeyJustPressed(code: string): boolean {
    return this._keyboard.justPressed.has(code);
  }

  isKeyJustReleased(code: string): boolean {
    return this._keyboard.justReleased.has(code);
  }

  getGamepad(index: number): GamepadState | undefined {
    return this._gamepads.get(index);
  }

  // ── Lifecycle ──

  attach(target: EventTarget): void {
    this.dispose();
    this._target = target;

    const listen = (
      t: EventTarget,
      type: string,
      handler: (e: Event) => void
    ) => {
      t.addEventListener(type, handler);
      this._cleanups.push(() => t.removeEventListener(type, handler));
    };

    listen(target, "keydown", this._onKeyDown);
    listen(target, "keyup", this._onKeyUp);
    listen(target, "mousemove", this._onMouseMove);
    listen(target, "mousedown", this._onMouseDown);
    listen(target, "mouseup", this._onMouseUp);
    listen(target, "wheel", this._onWheel);

    // blur on window to clear stuck keys
    if (typeof globalThis.window !== "undefined") {
      listen(globalThis.window, "blur", this._onBlur);
    }
  }

  poll(): void {
    // ── Keyboard snapshot ──
    const kbHeld = new Set(this._keyAccum.held);
    const kbPressed = new Set(this._keyAccum.pressed);
    const kbReleased = new Set(this._keyAccum.released);
    this._keyboard = {
      held: kbHeld,
      justPressed: kbPressed,
      justReleased: kbReleased,
    };
    this._keyAccum.pressed.clear();
    this._keyAccum.released.clear();

    // ── Mouse snapshot ──
    const mouseButtons: [ButtonState, ButtonState, ButtonState] = [
      { down: false, justPressed: false, justReleased: false },
      { down: false, justPressed: false, justReleased: false },
      { down: false, justPressed: false, justReleased: false },
    ];
    for (let i = 0; i < 3; i++) {
      mouseButtons[i] = {
        down: this._mouseAccum.buttonsDown[i],
        justPressed: this._mouseAccum.buttonsPressed[i],
        justReleased: this._mouseAccum.buttonsReleased[i],
      };
    }
    this._mouse = {
      x: this._mouseAccum.x,
      y: this._mouseAccum.y,
      dx: this._mouseAccum.dx,
      dy: this._mouseAccum.dy,
      scrollX: this._mouseAccum.scrollX,
      scrollY: this._mouseAccum.scrollY,
      buttons: mouseButtons,
    };
    // Reset deltas
    this._mouseAccum.dx = 0;
    this._mouseAccum.dy = 0;
    this._mouseAccum.scrollX = 0;
    this._mouseAccum.scrollY = 0;
    this._mouseAccum.buttonsPressed = [false, false, false];
    this._mouseAccum.buttonsReleased = [false, false, false];

    // ── Gamepad snapshot ──
    this._pollGamepads();
  }

  private _pollGamepads(): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;

    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) {
        this._gamepads.delete(i);
        this._prevGamepadButtons.delete(i);
        continue;
      }

      const prev = this._prevGamepadButtons.get(i) ?? [];
      const buttons: GamepadButtonState[] = [];
      const currentDown: boolean[] = [];

      for (let b = 0; b < pad.buttons.length; b++) {
        const down = pad.buttons[b].pressed;
        const wasDown = prev[b] ?? false;
        currentDown.push(down);
        buttons.push({
          down,
          justPressed: down && !wasDown,
          justReleased: !down && wasDown,
          value: pad.buttons[b].value,
        });
      }

      this._prevGamepadButtons.set(i, currentDown);
      this._gamepads.set(i, {
        connected: true,
        axes: pad.axes.slice(),
        buttons,
      });
    }
  }

  dispose(): void {
    for (const cleanup of this._cleanups) {
      cleanup();
    }
    this._cleanups.length = 0;
    this._target = null;
  }

  // ── Simulate helpers (for testing without DOM) ──

  simulateKeyDown(code: string): void {
    if (!this._keyAccum.held.has(code)) {
      this._keyAccum.held.add(code);
      this._keyAccum.pressed.add(code);
    }
  }

  simulateKeyUp(code: string): void {
    this._keyAccum.held.delete(code);
    this._keyAccum.released.add(code);
  }

  simulateMouseMove(x: number, y: number, dx: number, dy: number): void {
    this._mouseAccum.x = x;
    this._mouseAccum.y = y;
    this._mouseAccum.dx += dx;
    this._mouseAccum.dy += dy;
  }

  simulateMouseDown(button: number): void {
    if (button >= 0 && button < 3) {
      this._mouseAccum.buttonsDown[button] = true;
      this._mouseAccum.buttonsPressed[button] = true;
    }
  }

  simulateMouseUp(button: number): void {
    if (button >= 0 && button < 3) {
      this._mouseAccum.buttonsDown[button] = false;
      this._mouseAccum.buttonsReleased[button] = true;
    }
  }

  simulateScroll(scrollX: number, scrollY: number): void {
    this._mouseAccum.scrollX += scrollX;
    this._mouseAccum.scrollY += scrollY;
  }
}
