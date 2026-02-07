import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    uptime: number;
    timestamp: string;
    checks: Record<string, boolean>;
}

export function registerHealthRoute(app: FastifyInstance) {
    app.get('/health', async (_req, reply) => {
        const checks: Record<string, boolean> = {
            vault: existsSync('/vault'),
            config: existsSync('/config'),
        };

        const passed = Object.values(checks).filter(Boolean).length;
        const total = Object.values(checks).length;
        const status: HealthStatus['status'] =
            passed === total ? 'healthy' : passed > 0 ? 'degraded' : 'unhealthy';

        const body: HealthStatus = {
            status,
            version: process.env.npm_package_version ?? '0.1.0',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            checks,
        };

        reply.code(status === 'unhealthy' ? 503 : 200).send(body);
    });
}
