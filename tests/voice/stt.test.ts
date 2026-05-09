import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { transcribe } from '../../src/voice/stt.js';

describe('transcribe', () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('POSTs multipart to /v1/audio/transcriptions and returns text', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ text: 'hello world' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const result = await transcribe({
            url: 'http://stt.example',
            model: 'whisper-1',
            audio: Buffer.from('fakeaudio'),
            filename: 'test.m4a',
            mimeType: 'audio/m4a',
        });

        expect(result.text).toBe('hello world');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('http://stt.example/v1/audio/transcriptions');
        expect(init.method).toBe('POST');
        expect(init.body).toBeInstanceOf(FormData);

        const fd = init.body as FormData;
        expect(fd.get('model')).toBe('whisper-1');
        expect(fd.get('response_format')).toBe('json');
        const filePart = fd.get('file');
        expect(filePart).toBeInstanceOf(Blob);
    });

    it('strips trailing slash from base url', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ text: 'ok' }), { status: 200 }),
        );

        await transcribe({
            url: 'http://stt.example/',
            model: 'whisper-1',
            audio: Buffer.from('x'),
            filename: 'a.m4a',
            mimeType: 'audio/m4a',
        });

        const [calledUrl] = fetchMock.mock.calls[0] as [string];
        expect(calledUrl).toBe('http://stt.example/v1/audio/transcriptions');
    });

    it('throws on non-2xx status', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
        );

        await expect(
            transcribe({
                url: 'http://stt.example',
                model: 'whisper-1',
                audio: Buffer.from('x'),
                filename: 'a.m4a',
                mimeType: 'audio/m4a',
            }),
        ).rejects.toThrow(/STT request failed/);
    });

    it('throws when response missing text field', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({}), { status: 200 }),
        );

        await expect(
            transcribe({
                url: 'http://stt.example',
                model: 'whisper-1',
                audio: Buffer.from('x'),
                filename: 'a.m4a',
                mimeType: 'audio/m4a',
            }),
        ).rejects.toThrow(/missing "text"/);
    });
});
