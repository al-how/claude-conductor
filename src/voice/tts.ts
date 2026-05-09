export interface SynthesizeOptions {
    url: string;
    model: string;
    voice: string;
    input: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export async function synthesize(opts: SynthesizeOptions): Promise<Buffer> {
    const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 60_000);
    const endpoint = `${opts.url.replace(/\/$/, '')}/v1/audio/speech`;

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: opts.model,
            voice: opts.voice,
            input: opts.input,
            response_format: 'mp3',
        }),
        signal,
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`TTS request failed: ${res.status} ${res.statusText} ${body.slice(0, 500)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
}
