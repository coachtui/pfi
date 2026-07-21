import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// PDF.js uses browser geometry globals for both text extraction and rendering.
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as typeof globalThis.Path2D;

// Register the worker implementation directly. PDF.js otherwise uses a
// runtime dynamic import that serverless bundlers cannot reliably trace.
const pdfjsGlobal = globalThis as typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler };
};
pdfjsGlobal.pdfjsWorker = { WorkerMessageHandler };

// PDF.js 6 requires an explicit worker module even when it creates a fake
// worker in Node. Keep it pinned to the worker shipped with this package.
pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";

export { pdfjs };
