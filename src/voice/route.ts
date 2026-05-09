import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';

import type { DatabaseManager } from '../db/index.js';
import type { Dispatcher } from '../dispatcher/index.js';
import type { EnabledVoiceConfig, TelegramConfig, OllamaConfig, OpenRouterConfig } from '../config/schema.js';
import type { ClaudeResult } from '../claude/invoke.js';
import { extractResponseText } from '../claude/invoke.js';
import { escapePromptContent } from '../telegram/utils.js';
import { resolveExecutionTarget } from '../claude/models.js';

import { transcribe } from './stt.js';
import { synthesize } from './tts.js';
import { isStopWord } from './stop-words.js';
import { normalizeForSpeech } from './normalize.js';

interface VoiceRouteDeps {
    db: DatabaseManager;
    dispatcher: Dispatcher;
    voice: EnabledVoiceConfig;
    telegram?: TelegramConfig;
    vaultPath: string;
    logger: Logger;
    globalModel?: string;
    globalProvider?: 'claude' | 'openrouter' | 'ollama';
    ollamaConfig?: OllamaConfig;
    openRouterConfig?: OpenRouterConfig;
}

function buildBootstrapPrompt(db: DatabaseManager, chatId: number, transcript: string): string {
    const history = db.getRecentContext(chatId, 20);
    if (history.length === 0) return transcript;
    const block = history
        .map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${escapePromptContent(m.content)}`)
        .join('\n\n');
    return `<conversation_history>\n${block}\n</conversation_history>\n\nHuman: ${transcript}`;
}

export function registerVoiceRoutes(app: FastifyInstance, deps: VoiceRouteDeps): void {
    const { db, dispatcher, voice, vaultPath, logger, globalModel, globalProvider, ollamaConfig, openRouterConfig } = deps;

    app.post('/voice/turn', async (request, reply) => {
        if (voice.auth_token) {
            const auth = request.headers.authorization ?? '';
            if (auth !== `Bearer ${voice.auth_token}`) {
                return reply.status(401).send({ error: 'unauthorized' });
            }
        }

        let filePart: Awaited<ReturnType<typeof request.file>>;
        try {
            filePart = await request.file();
        } catch (err) {
            logger.warn({ err }, 'voice: multipart parse failed');
            return reply.status(400).send({ error: 'invalid multipart body' });
        }
        if (!filePart) {
            return reply.status(400).send({ error: 'missing audio file (field name: audio)' });
        }

        let audioBuffer: Buffer;
        try {
            audioBuffer = await filePart.toBuffer();
        } catch (err) {
            // toBuffer throws on size limit
            logger.warn({ err }, 'voice: audio buffer read failed');
            return reply.status(413).send({ error: 'audio too large' });
        }

        const filename = filePart.filename || 'audio.m4a';
        const mimeType = filePart.mimetype || 'audio/m4a';

        let transcript: string;
        try {
            const stt = await transcribe({
                url: voice.stt_url,
                model: voice.stt_model,
                audio: audioBuffer,
                filename,
                mimeType,
            });
            transcript = stt.text.trim();
        } catch (err) {
            logger.error({ err }, 'voice: STT failed');
            return reply.status(502).send({ error: 'transcription failed' });
        }

        if (!transcript) {
            reply.header('X-Voice-Continue', 'false');
            return reply.status(204).send();
        }

        if (isStopWord(transcript, voice.stop_words)) {
            logger.info({ transcript }, 'voice: stop phrase detected');
            reply.header('X-Voice-Continue', 'false');
            return reply.status(204).send();
        }

        const chatId = voice.chat_id;
        const sessionId = db.getSessionId(chatId) ?? undefined;

        // Build bootstrap prompt BEFORE saving the user message so getRecentContext
        // does not include the current turn, which would duplicate it in the prompt.
        const prompt = sessionId ? transcript : buildBootstrapPrompt(db, chatId, transcript);

        try {
            db.saveMessage(chatId, 'user', transcript, 'voice');
        } catch (err) {
            logger.error({ err }, 'voice: failed to save user message');
        }

        // Resolve execution target using the chat's sticky provider/model settings so
        // voice turns share the same effective provider as the paired Telegram session.
        const chatSettings = db.getChatSettings(chatId);
        let target;
        try {
            target = resolveExecutionTarget({
                model: chatSettings?.model ?? undefined,
                provider: chatSettings?.provider ?? globalProvider ?? undefined,
                globalModel,
                ollamaConfig,
                openRouterConfig,
            });
        } catch (err) {
            logger.error({ err }, 'voice: failed to resolve execution target');
            return reply.status(500).send({ error: 'provider configuration error' });
        }
        const { model, providerEnv } = target;

        let result: ClaudeResult;
        let capturedSessionId: string | undefined;
        try {
            result = await new Promise<ClaudeResult>((resolve, reject) => {
                dispatcher.enqueue({
                    id: `voice-${randomUUID()}`,
                    source: 'voice',
                    prompt,
                    workingDir: vaultPath,
                    logger,
                    dangerouslySkipPermissions: true,
                    includePartialMessages: false,
                    ...(sessionId ? { sessionId, resume: true } : {}),
                    ...(model ? { model } : {}),
                    ...(providerEnv ? { providerEnv } : {}),
                    // Capture session ID but do not persist yet — deferred until TTS succeeds.
                    onComplete: async (r) => {
                        capturedSessionId = r.sessionId;
                        resolve(r);
                    },
                    onError: async (e) => reject(e),
                });
            });
        } catch (err) {
            logger.error({ err }, 'voice: Claude invocation failed');
            return reply.status(500).send({ error: 'claude invocation failed' });
        }

        const rawText = extractResponseText(result);
        const responseText = normalizeForSpeech(
            rawText && rawText.trim().length > 0 ? rawText : '(empty response)',
            voice.response_max_chars,
        );

        let audio: Buffer;
        try {
            audio = await synthesize({
                url: voice.tts_url,
                model: voice.tts_model,
                voice: voice.tts_voice,
                input: responseText,
            });
        } catch (err) {
            logger.error({ err }, 'voice: TTS failed');
            // Do not persist session advance or assistant message — caller never heard the reply.
            return reply.status(502).send({ error: 'synthesis failed' });
        }

        // Persist session and assistant message only after TTS succeeds so a TTS failure
        // leaves the shared session in a retryable state.
        if (capturedSessionId) {
            try { db.saveSessionId(chatId, capturedSessionId); }
            catch (e) { logger.error({ err: e }, 'voice: failed to save session id'); }
        }
        try {
            db.saveMessage(chatId, 'assistant', responseText, 'voice');
        } catch (err) {
            logger.error({ err }, 'voice: failed to save assistant message');
        }

        reply.header('Content-Type', 'audio/mpeg');
        reply.header('X-Voice-Continue', 'true');
        return reply.send(audio);
    });

    logger.info({ chat_id: voice.chat_id }, 'Voice route registered at POST /voice/turn');
}
