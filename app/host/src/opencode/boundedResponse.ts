export const CONTROL_RESPONSE_LIMIT = 16 * 1024 * 1024;
/** Bound bytes before SDK JSON parsing, including chunked responses. */
export async function boundedResponse(response: Response, signal: AbortSignal): Promise<Response> {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  let removeAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => { void reader.cancel().catch(() => {}); reject(new Error('Native control request expired')); };
    signal.addEventListener('abort', stop, { once: true });
    removeAbort = () => signal.removeEventListener('abort', stop);
    if (signal.aborted) stop();
  });
  try {
    if (Number(response.headers.get('content-length')) > CONTROL_RESPONSE_LIMIT) throw new Error('Native control response exceeds capacity');
    for (;;) {
      const next = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new Error("Native control request expired");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > CONTROL_RESPONSE_LIMIT) throw new Error('Native control response exceeds capacity');
      chunks.push(next.value);
    }
    return new Response(Buffer.concat(chunks, size), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch { void reader.cancel().catch(() => {}); throw new Error('Native control response unavailable or exceeds capacity'); }
  finally { removeAbort(); }
}
