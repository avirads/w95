export { DISK_IMAGE } from "./disk-image.mjs";

// V86 reads image parts with XHR. A disk-only worker caches these without
// changing the runtime or persisting the guest's in-memory disk writes.
export async function prepareDiskCache() {
  if (!globalThis.isSecureContext || !("serviceWorker" in navigator)) return false;
  const workers = navigator.serviceWorker;
  const script = new URL("./disk-cache-sw.js", import.meta.url).href;
  let timer;
  let onChange;
  const controlled = new Promise(resolve => {
    onChange = () => {
      if (workers.controller?.scriptURL === script) resolve(true);
    };
    workers.addEventListener("controllerchange", onChange);
  });
  try {
    return await Promise.race([
      (async () => {
        await workers.register(script, {
          type: "module",
          scope: new URL("./", import.meta.url).href,
          updateViaCache: "none",
        });
        onChange();
        return controlled;
      })(),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 4000); }),
    ]);
  } catch (error) {
    console.warn("Disk cache unavailable; using server downloads.", error);
    return false;
  } finally {
    clearTimeout(timer);
    workers.removeEventListener("controllerchange", onChange);
  }
}
