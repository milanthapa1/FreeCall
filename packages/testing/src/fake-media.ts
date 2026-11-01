/**
 * Fake media helpers for Playwright and unit tests.
 *
 * Provides utilities for creating synthetic MediaStream objects and fake video frames
 * without real camera/microphone devices.
 */

/**
 * Returns Playwright launch args that enable fake media devices.
 * Pass these to `chromium.launch({ args })` in playwright.config.ts.
 */
export function fakeMediaLaunchArgs(): string[] {
  return [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-file-for-fake-video-capture=/dev/null",
    "--use-file-for-fake-audio-capture=/dev/null",
  ];
}

/**
 * Minimal MediaStream stub for jsdom environments.
 *
 * jsdom does not implement MediaDevices; tests that import components using `getUserMedia`
 * should install this stub on `globalThis.navigator.mediaDevices` before rendering.
 */
export function createFakeMediaDevices(
  opts: { granted?: boolean } = {},
): Pick<MediaDevices, "getUserMedia" | "enumerateDevices"> {
  const granted = opts.granted ?? true;

  return {
    async getUserMedia(_constraints): Promise<MediaStream> {
      if (!granted) {
        const err = new DOMException("Permission denied", "NotAllowedError");
        throw err;
      }
      // Return a no-op MediaStream stub.
      return {
        getTracks: () => [],
        getVideoTracks: () => [],
        getAudioTracks: () => [],
        addTrack: () => undefined,
        removeTrack: () => undefined,
        active: true,
        id: "fake-stream",
      } as unknown as MediaStream;
    },

    async enumerateDevices(): Promise<MediaDeviceInfo[]> {
      if (!granted) return [];
      return [
        {
          deviceId: "fake-video-0",
          groupId: "group-0",
          kind: "videoinput",
          label: "Fake Camera",
          toJSON: () => ({}),
        },
        {
          deviceId: "fake-audio-0",
          groupId: "group-0",
          kind: "audioinput",
          label: "Fake Microphone",
          toJSON: () => ({}),
        },
      ];
    },
  };
}

/**
 * A minimal 1×1 JPEG in base64 (used as a fake video frame in moderation tests).
 */
export const FAKE_FRAME_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=";
