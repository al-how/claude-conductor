export interface TranscribeOptions {
    url: string;
    model: string;
    audio: Buffer;
    filename: string;
    mimeType: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export async function transcribe(opts: TranscribeOptions): Promise<{ text: string }> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(opts.audio)], { type: opts.mimeType });
    form.append('file', blob, opts.filename);
    form.append('model', opts.model);
    form.append('response_format', 'json');

    const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 60_000);
    const endpoint = `${opts.url.replace(/\/$/, '')}/v1/audio/transcriptions`;

    const res = await fetch(endpoint, { method: 'POST', body: form, signal });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`STT request failed: ${res.status} ${res.statusText} ${body.slice(0, 500)}`);
    }

    const data = await res.json() as { text?: unknown };
    if (typeof data.text !== 'string') {
        throw new Error('STT response missing "text" field');
    }
    return { text: data.text };
}
