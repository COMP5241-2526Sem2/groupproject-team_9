export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode('event: start\ndata: {"ok":true}\n\n')
      );
      await new Promise((r) => setTimeout(r, 500));
      controller.enqueue(
        encoder.encode('event: delta\ndata: {"text":"hello"}\n\n')
      );
      await new Promise((r) => setTimeout(r, 500));
      controller.enqueue(
        encoder.encode('event: done\ndata: {"ok":true}\n\n')
      );
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}