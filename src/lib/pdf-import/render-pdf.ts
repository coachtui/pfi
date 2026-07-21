import { createCanvas } from "@napi-rs/canvas";
import { pdfjs } from "./pdfjs-node";

export async function renderPdfPagesWithPdfjs(
  bytes: Uint8Array,
  options: { dpi: number; maxDimension: number },
): Promise<Buffer[]> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  let document: pdfjs.PDFDocumentProxy | null = null;

  try {
    document = await loadingTask.promise;
    const images: Buffer[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: options.dpi / 72 });
      const scale = Math.min(1, options.maxDimension / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: (options.dpi / 72) * scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      }).promise;
      images.push(canvas.toBuffer("image/png"));
      page.cleanup();
    }
    return images;
  } finally {
    await document?.cleanup();
  }
}
