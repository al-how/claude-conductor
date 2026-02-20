import type { FastifyInstance } from 'fastify';
import { readdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const DEFAULT_SKILLS_DIR = '/home/claude/.claude/skills/';

interface SkillInfo {
    name: string;
    description: string;
    enabled: boolean;
}

function parseSkillFrontmatter(skillDir: string): { name?: string; description?: string } {
    const skillMdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) return {};

    const content = readFileSync(skillMdPath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};

    try {
        const frontmatter = parseYaml(match[1]);
        return {
            name: frontmatter?.name,
            description: frontmatter?.description,
        };
    } catch {
        return {};
    }
}

export function registerSkillsRoutes(app: FastifyInstance) {
    const skillsDir = process.env.SKILLS_DIR || DEFAULT_SKILLS_DIR;

    app.get('/api/skills', async () => {
        if (!existsSync(skillsDir)) {
            return { skills: [] };
        }

        const entries = readdirSync(skillsDir, { withFileTypes: true });
        const skills: SkillInfo[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const dirName = entry.name;
            const disabled = dirName.endsWith('.disabled');
            const baseName = disabled ? dirName.slice(0, -'.disabled'.length) : dirName;
            const fullPath = join(skillsDir, dirName);

            const frontmatter = parseSkillFrontmatter(fullPath);

            skills.push({
                name: baseName,
                description: frontmatter.description ?? '',
                enabled: !disabled,
            });
        }

        return { skills };
    });

    app.patch('/api/skills/:name', async (request, reply) => {
        const { name } = request.params as { name: string };
        const { enabled } = request.body as { enabled: boolean };

        if (typeof enabled !== 'boolean') {
            return reply.status(400).send({ error: 'Body must include { enabled: boolean }' });
        }

        if (!existsSync(skillsDir)) {
            return reply.status(404).send({ error: 'Skills directory not found' });
        }

        const enabledPath = join(skillsDir, name);
        const disabledPath = join(skillsDir, `${name}.disabled`);

        if (enabled) {
            // Enable: rename .disabled → name
            if (!existsSync(disabledPath)) {
                if (existsSync(enabledPath)) {
                    return { success: true, name, enabled: true }; // Already enabled
                }
                return reply.status(404).send({ error: 'Skill not found' });
            }
            renameSync(disabledPath, enabledPath);
        } else {
            // Disable: rename name → .disabled
            if (!existsSync(enabledPath)) {
                if (existsSync(disabledPath)) {
                    return { success: true, name, enabled: false }; // Already disabled
                }
                return reply.status(404).send({ error: 'Skill not found' });
            }
            renameSync(enabledPath, disabledPath);
        }

        return { success: true, name, enabled };
    });
}
