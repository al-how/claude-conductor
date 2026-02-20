import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import { registerSkillsRoutes } from '../../src/server/skills-routes.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Skills API Routes', () => {
    let app: ReturnType<typeof fastify>;
    let skillsDir: string;

    beforeEach(async () => {
        skillsDir = join(tmpdir(), `skills-test-${Date.now()}`);
        mkdirSync(skillsDir, { recursive: true });
        process.env.SKILLS_DIR = skillsDir;

        app = fastify({ logger: false });
        registerSkillsRoutes(app);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        rmSync(skillsDir, { recursive: true, force: true });
        delete process.env.SKILLS_DIR;
    });

    it('GET /api/skills should return empty array when no skills', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/skills' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ skills: [] });
    });

    it('GET /api/skills should list skills with frontmatter', async () => {
        const skillDir = join(skillsDir, 'my-skill');
        mkdirSync(skillDir);
        writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: My Skill\ndescription: Does stuff\n---\nContent here');

        const res = await app.inject({ method: 'GET', url: '/api/skills' });
        expect(res.statusCode).toBe(200);
        const { skills } = res.json();
        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('my-skill');
        expect(skills[0].description).toBe('Does stuff');
        expect(skills[0].enabled).toBe(true);
    });

    it('GET /api/skills should detect disabled skills', async () => {
        const skillDir = join(skillsDir, 'disabled-skill.disabled');
        mkdirSync(skillDir);
        writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Disabled\ndescription: Off\n---\n');

        const res = await app.inject({ method: 'GET', url: '/api/skills' });
        const { skills } = res.json();
        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('disabled-skill');
        expect(skills[0].enabled).toBe(false);
    });

    it('GET /api/skills should handle missing skills directory', async () => {
        rmSync(skillsDir, { recursive: true, force: true });
        const res = await app.inject({ method: 'GET', url: '/api/skills' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ skills: [] });
    });

    it('PATCH /api/skills/:name should disable a skill', async () => {
        const skillDir = join(skillsDir, 'toggle-skill');
        mkdirSync(skillDir);

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/skills/toggle-skill',
            payload: { enabled: false },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().enabled).toBe(false);
        expect(existsSync(join(skillsDir, 'toggle-skill.disabled'))).toBe(true);
        expect(existsSync(join(skillsDir, 'toggle-skill'))).toBe(false);
    });

    it('PATCH /api/skills/:name should enable a disabled skill', async () => {
        const skillDir = join(skillsDir, 're-enable.disabled');
        mkdirSync(skillDir);

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/skills/re-enable',
            payload: { enabled: true },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().enabled).toBe(true);
        expect(existsSync(join(skillsDir, 're-enable'))).toBe(true);
        expect(existsSync(join(skillsDir, 're-enable.disabled'))).toBe(false);
    });

    it('PATCH /api/skills/:name should return 404 for nonexistent skill', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/skills/nonexistent',
            payload: { enabled: true },
        });
        expect(res.statusCode).toBe(404);
    });

    it('PATCH /api/skills/:name should return 400 for invalid body', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/skills/some-skill',
            payload: { enabled: 'yes' },
        });
        expect(res.statusCode).toBe(400);
    });
});
