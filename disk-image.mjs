// This directory is an immutable image revision. When replacing any image bytes,
// publish a NEW directory and change this URL; never overwrite a cached revision.
export const DISK_IMAGE = Object.freeze({
  url: new URL("images/windows95-v3-restored/.img", import.meta.url).href,
  size: 471859200,
  chunkSize: 256 * 1024,
});
