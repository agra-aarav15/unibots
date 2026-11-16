import { spawn } from "node:child_process";
import type { ComputerAction } from "@unibot/adapter-kit";
import koffi from "koffi";
import type { NativeScreen, NativeScreenFrame } from "./native-screen.js";
import { windowsKeyStrokes } from "./native-screen-keys.js";

const SRCCOPY = 0x00cc0020;
const DIB_RGB_COLORS = 0;
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_HWHEEL = 0x1000;
const MOUSEEVENTF_ABSOLUTE = 0x8000;
const MOUSEEVENTF_VIRTUALDESK = 0x4000;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const WHEEL_DELTA = 120;
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;
const PROCESS_PER_MONITOR_DPI_AWARE = -4;
/** Keeps one observation inside the transport's body limit even after base64 encoding. */
const MAX_OBSERVATION_BYTES = 6 * 1024 * 1024;
const MAX_WAIT_MS = 60_000;
/** One SendInput call carries a whole typed message without building an unbounded array. */
const MAX_INPUTS_PER_CALL = 256;

const MOUSE_INPUT = koffi.struct("UniBotMouseInput", {
  dx: "int32_t",
  dy: "int32_t",
  mouseData: "uint32_t",
  dwFlags: "uint32_t",
  time: "uint32_t",
  dwExtraInfo: "uintptr_t",
});
const KEY_INPUT = koffi.struct("UniBotKeyInput", {
  wVk: "uint16_t",
  wScan: "uint16_t",
  dwFlags: "uint32_t",
  time: "uint32_t",
  dwExtraInfo: "uintptr_t",
});
const HARDWARE_INPUT = koffi.struct("UniBotHardwareInput", {
  uMsg: "uint32_t",
  wParamL: "uint16_t",
  wParamH: "uint16_t",
});
const INPUT_UNION = koffi.union("UniBotInputUnion", {
  mi: MOUSE_INPUT,
  ki: KEY_INPUT,
  hi: HARDWARE_INPUT,
});
const INPUT = koffi.struct("UniBotInput", { type: "uint32_t", input: INPUT_UNION });

interface MouseEvent {
  dx: number;
  dy: number;
  mouseData: number;
  dwFlags: number;
  time: number;
  dwExtraInfo: number;
}
interface KeyEvent {
  wVk: number;
  wScan: number;
  dwFlags: number;
  time: number;
  dwExtraInfo: number;
}
type WindowEvent = { type: number; input: { mi: MouseEvent } | { ki: KeyEvent } };

let api: ReturnType<typeof loadApi> | undefined;

function loadApi() {
  const user32 = koffi.load("user32.dll");
  const gdi32 = koffi.load("gdi32.dll");
  return {
    SendInput: user32.func("uint32_t __stdcall SendInput(uint32_t, UniBotInput *, int)"),
    SetProcessDpiAwarenessContext: user32.func(
      "int __stdcall SetProcessDpiAwarenessContext(intptr_t)",
    ),
    GetSystemMetrics: user32.func("int __stdcall GetSystemMetrics(int)"),
    GetCursorPos: user32.func("int __stdcall GetCursorPos(void *)"),
    GetForegroundWindow: user32.func("uintptr_t __stdcall GetForegroundWindow()"),
    GetWindowTextW: user32.func("int __stdcall GetWindowTextW(uintptr_t, void *, int)"),
    CreateDCW: gdi32.func("void * __stdcall CreateDCW(str16, str16, str16, void *)"),
    CreateCompatibleDC: gdi32.func("void * __stdcall CreateCompatibleDC(void *)"),
    CreateCompatibleBitmap: gdi32.func("void * __stdcall CreateCompatibleBitmap(void *, int, int)"),
    SelectObject: gdi32.func("void * __stdcall SelectObject(void *, void *)"),
    BitBlt: gdi32.func(
      "int __stdcall BitBlt(void *, int, int, int, int, void *, int, int, uint32_t)",
    ),
    GetDIBits: gdi32.func(
      "int __stdcall GetDIBits(void *, void *, uint32_t, uint32_t, void *, void *, uint32_t)",
    ),
    DeleteObject: gdi32.func("int __stdcall DeleteObject(void *)"),
    DeleteDC: gdi32.func("int __stdcall DeleteDC(void *)"),
  };
}

function win32() {
  api ??= loadApi();
  return api;
}

/** The INPUT array stride, which differs between 64-bit and 32-bit Windows. Verify it, never guess. */
function inputStride() {
  const size = koffi.sizeof(INPUT);
  if (size !== 40 && size !== 28) throw new Error("Unsupported Windows input layout");
  return size;
}

function virtualScreen() {
  const { GetSystemMetrics } = win32();
  return {
    x: GetSystemMetrics(SM_XVIRTUALSCREEN),
    y: GetSystemMetrics(SM_YVIRTUALSCREEN),
    width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
    height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
  };
}

function cursorPosition() {
  const { GetCursorPos } = win32();
  const point = Buffer.alloc(8);
  return GetCursorPos(point) ? { x: point.readInt32LE(0), y: point.readInt32LE(4) } : undefined;
}

function activeWindow() {
  const { GetForegroundWindow, GetWindowTextW } = win32();
  const handle = GetForegroundWindow();
  if (!handle) return undefined;
  const text = Buffer.alloc(1024);
  const length = GetWindowTextW(handle, text, 512);
  const title = length > 0 ? text.toString("utf16le", 0, length * 2) : "";
  return { id: String(handle), ...(title ? { title } : {}) };
}

function inputStrokes(events: WindowEvent[]) {
  const { SendInput } = win32();
  for (let index = 0; index < events.length; index += MAX_INPUTS_PER_CALL) {
    const batch = events.slice(index, index + MAX_INPUTS_PER_CALL);
    const sent = SendInput(batch.length, batch, inputStride());
    if (sent !== batch.length) throw new Error("The computer did not accept the input");
  }
}

function mouseEvent(mouse: Partial<MouseEvent> & { dwFlags: number }): WindowEvent {
  return {
    type: INPUT_MOUSE,
    input: {
      mi: {
        dx: mouse.dx ?? 0,
        dy: mouse.dy ?? 0,
        mouseData: mouse.mouseData ?? 0,
        dwFlags: mouse.dwFlags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
}

function keyEvent(key: Partial<KeyEvent> & { dwFlags: number }): WindowEvent {
  return {
    type: INPUT_KEYBOARD,
    input: {
      ki: {
        wVk: key.wVk ?? 0,
        wScan: key.wScan ?? 0,
        dwFlags: key.dwFlags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
}

/** Absolute coordinates are 0..65535 across the whole virtual desktop, not the primary screen. */
function moveTo(x: number, y: number, view: { width: number; height: number }): WindowEvent {
  const screen = virtualScreen();
  // A frame is captured at the virtual screen's size, so a point in it scales back onto that span.
  const normalized = (value: number, span: number) =>
    Math.min(Math.max(Math.round((value * 65535) / Math.max(span - 1, 1)), 0), 65535);
  return mouseEvent({
    dx: normalized((x * screen.width) / Math.max(view.width, 1), screen.width),
    dy: normalized((y * screen.height) / Math.max(view.height, 1), screen.height),
    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
  });
}

function pointerEvents(
  action: Extract<ComputerAction, { kind: "pointer" }>,
  view: { width: number; height: number },
): WindowEvent[] {
  const button = action.button ?? "left";
  const down = button === "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
  const up = button === "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
  const events = [moveTo(action.x, action.y, view)];
  if (action.type === "click")
    events.push(mouseEvent({ dwFlags: down }), mouseEvent({ dwFlags: up }));
  else if (action.type === "down") events.push(mouseEvent({ dwFlags: down }));
  else if (action.type === "up") events.push(mouseEvent({ dwFlags: up }));
  return events;
}

function scrollEvents(
  action: Extract<ComputerAction, { kind: "scroll" }>,
  view: { width: number; height: number },
): WindowEvent[] {
  const amount = Math.max(Math.round(action.amount ?? 1), 1);
  const horizontal = action.direction === "left" || action.direction === "right";
  const positive = action.direction === "up" || action.direction === "right";
  const events: WindowEvent[] = [];
  if (action.x !== undefined && action.y !== undefined)
    events.push(moveTo(action.x, action.y, view));
  events.push(
    mouseEvent({
      mouseData: (positive ? WHEEL_DELTA : -WHEEL_DELTA) * amount,
      dwFlags: horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL,
    }),
  );
  return events;
}

function keyboardEvents(action: Extract<ComputerAction, { kind: "key" }>): WindowEvent[] {
  return windowsKeyStrokes(action.key, action.modifiers).map((stroke) =>
    stroke.kind === "unicode"
      ? keyEvent({
          wScan: stroke.code,
          dwFlags: KEYEVENTF_UNICODE | (stroke.up ? KEYEVENTF_KEYUP : 0),
        })
      : keyEvent({
          wVk: stroke.vk,
          dwFlags:
            (stroke.extended ? KEYEVENTF_EXTENDEDKEY : 0) | (stroke.up ? KEYEVENTF_KEYUP : 0),
        }),
  );
}

/**
 * Types text into whatever holds the keyboard, the same way every other computer provider does.
 * Line and tab characters become the keys that actually produce them.
 */
function typingEvents(text: string): WindowEvent[] {
  const events: WindowEvent[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0x0a || unit === 0x0d) {
      if (unit === 0x0d && text.charCodeAt(index + 1) === 0x0a) index += 1;
      events.push(...keyboardEvents({ kind: "key", key: "Enter" }));
      continue;
    }
    if (unit === 0x09) {
      events.push(...keyboardEvents({ kind: "key", key: "Tab" }));
      continue;
    }
    // Code units, so each half of a surrogate pair is sent as its own scan code.
    events.push(
      keyEvent({ wScan: unit, dwFlags: KEYEVENTF_UNICODE }),
      keyEvent({ wScan: unit, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP }),
    );
  }
  return events;
}

/** Opens a file, folder or URL with whatever this machine associates with it. */
async function openWithThisComputer(target: string) {
  await startProcess("explorer.exe", [target]);
}

async function startProcess(program: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

async function encode(
  bits: Buffer,
  width: number,
  height: number,
): Promise<Pick<NativeScreenFrame, "image" | "mimeType">> {
  const { default: sharp } = await import("sharp");
  // A screen DC hands back BGRA whose alpha byte is zero, so make it opaque and swap red with blue.
  for (let index = 3; index < bits.length; index += 4) bits[index] = 255;
  const opaque = sharp(bits, { raw: { width, height, channels: 4 } }).recomb([
    [0, 0, 1, 0],
    [0, 1, 0, 0],
    [1, 0, 0, 0],
    [0, 0, 0, 1],
  ]);
  const png = await opaque.clone().removeAlpha().png({ compressionLevel: 6 }).toBuffer();
  if (png.byteLength <= MAX_OBSERVATION_BYTES)
    return { image: new Uint8Array(png), mimeType: "image/png" };
  const jpeg = await opaque.removeAlpha().jpeg({ quality: 80 }).toBuffer();
  return { image: new Uint8Array(jpeg), mimeType: "image/jpeg" };
}

async function captureScreen(): Promise<NativeScreenFrame> {
  const {
    CreateDCW,
    CreateCompatibleDC,
    CreateCompatibleBitmap,
    SelectObject,
    BitBlt,
    GetDIBits,
    DeleteObject,
    DeleteDC,
  } = win32();
  const screen = virtualScreen();
  if (screen.width < 1 || screen.height < 1) throw new Error("This computer has no display");
  const screenDc = CreateDCW("DISPLAY", null, null, null);
  if (!screenDc) throw new Error("This computer has no display");
  const memoryDc = CreateCompatibleDC(screenDc);
  const bitmap = CreateCompatibleBitmap(screenDc, screen.width, screen.height);
  let bits: Buffer;
  try {
    const previous = SelectObject(memoryDc, bitmap);
    try {
      if (
        !BitBlt(memoryDc, 0, 0, screen.width, screen.height, screenDc, screen.x, screen.y, SRCCOPY)
      )
        throw new Error("Could not read the screen");
    } finally {
      // GetDIBits refuses a bitmap that is still selected into a device context.
      SelectObject(memoryDc, previous);
    }
    const header = Buffer.alloc(44);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(screen.width, 4);
    header.writeInt32LE(-screen.height, 8); // Negative height asks for top-down rows.
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(0, 16);
    bits = Buffer.alloc(screen.width * screen.height * 4);
    if (!GetDIBits(memoryDc, bitmap, 0, screen.height, bits, header, DIB_RGB_COLORS))
      throw new Error("Could not read the screen");
  } finally {
    DeleteObject(bitmap);
    DeleteDC(memoryDc);
    DeleteDC(screenDc);
  }
  const encoded = await encode(bits, screen.width, screen.height);
  const cursor = cursorPosition();
  const window = activeWindow();
  return {
    ...encoded,
    width: screen.width,
    height: screen.height,
    ...(cursor ? { cursor: { x: cursor.x - screen.x, y: cursor.y - screen.y } } : {}),
    ...(window ? { activeWindow: window } : {}),
  };
}

/** Reads and drives this machine's display through the Windows input and graphics APIs. */
export function createWin32Screen(): NativeScreen {
  const { SetProcessDpiAwarenessContext } = win32();
  // Physical pixels keep captured text sharp and keep injected coordinates aligned with the frame.
  // A process that is already DPI aware, such as Electron, refuses the call and is left alone.
  try {
    SetProcessDpiAwarenessContext(PROCESS_PER_MONITOR_DPI_AWARE);
  } catch {
    // A host that already declared its DPI awareness is exactly the case this tolerates.
  }
  let lastFrame: { width: number; height: number } = { width: 1, height: 1 };
  return {
    async capture() {
      const frame = await captureScreen();
      lastFrame = { width: frame.width, height: frame.height };
      return frame;
    },
    async perform(action) {
      if (action.kind === "wait") {
        await delay(Math.min(Math.max(Math.round(action.ms), 0), MAX_WAIT_MS));
        return;
      }
      if (action.kind === "open") return openWithThisComputer(action.path);
      if (action.kind === "launch")
        return startProcess(action.application, action.uri ? [action.uri] : []);
      if (action.kind === "focus")
        throw new Error("This computer cannot bring another app to the front");
      if (action.kind === "clipboard") return inputStrokes(typingEvents(action.text));
      if (action.kind === "scroll") return inputStrokes(scrollEvents(action, lastFrame));
      if (action.kind === "pointer") return inputStrokes(pointerEvents(action, lastFrame));
      return inputStrokes(keyboardEvents(action));
    },
    close() {
      api = undefined;
    },
  };
}
