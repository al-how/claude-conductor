import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { synthesize } from '../../src/voice/tts.js';

describe('synthesize', () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('POSTs JSON to /v1/audio/speech and returns audio Buffer', async () => {
        const audioBytes = new Uint8Array([1, 2, 3, 4, 5]);
        fetchMock.mockResolvedValueOnce(
            new Response(audioBytes, {
                status: 200,
                headers: { 'Content-Type': 'audio/mpeg' },
            }),
        );

        const buf = await synthesize({
            url: 'http://tts.example',
            model: 'kokoro',
            voice: 'af_sky',
            input: 'Hello there.',
        });

        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5]);

        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('http://tts.example/v1/audio/speech');
        expect(init.method).toBe('POST');

        const headers = init.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');

        const body = JSON.parse(init.body as string);
        expect(body).toEqual({
            model: 'kokoro',
            voice: 'af_sky',
            input: 'Hello there.',
            response_format: 'mp3',
        });
    });

    it('throws on non-2xx status', async () => {
        fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503, statusText: 'Service Unavailable' }));

        await expect(
            synthesize({
                url: 'http://tts.example',
                model: 'kokoro',
                voice: 'af_sky',
                input: 'hi',
            }),
        ).rejects.toThrow(/TTS request failed/);
    });
});
