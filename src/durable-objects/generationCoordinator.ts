import { DurableObject } from 'cloudflare:workers';

type Lease = { generationId: string; expiresAt: number };

export class GenerationCoordinator extends DurableObject {
    async fetch(request: Request): Promise<Response> {
        const { pathname } = new URL(request.url);
        const data = await request.json() as { generationId: string; ttlMs?: number };
        if (!data.generationId) return Response.json({ error: 'Missing generationId' }, { status: 400 });

        const now = Date.now();
        const current = await this.ctx.storage.get<Lease>('lease');

        if (pathname === '/acquire') {
            if (current && current.expiresAt > now) return Response.json({ acquired: false, generationId: current.generationId });
            const lease: Lease = { generationId: data.generationId, expiresAt: now + Math.min(Math.max(data.ttlMs ?? 1_800_000, 60_000), 3_600_000) };
            await this.ctx.storage.put('lease', lease);
            return Response.json({ acquired: true });
        }

        if (pathname === '/renew') {
            if (!current || current.generationId !== data.generationId || current.expiresAt <= now) return Response.json({ renewed: false });
            current.expiresAt = now + Math.min(Math.max(data.ttlMs ?? 1_800_000, 60_000), 3_600_000);
            await this.ctx.storage.put('lease', current);
            return Response.json({ renewed: true });
        }

        if (pathname === '/owns') return Response.json({ owns: !!current && current.generationId === data.generationId && current.expiresAt > now });

        if (pathname === '/release') {
            if (current?.generationId === data.generationId) await this.ctx.storage.delete('lease');
            return Response.json({ released: current?.generationId === data.generationId });
        }

        return Response.json({ error: 'Unknown action' }, { status: 404 });
    }
}

export const generationLease = async (env: Env, spotifyId: string, action: 'acquire' | 'renew' | 'owns' | 'release', generationId: string) => {

    const stub = env.GENERATION_COORDINATOR.get(env.GENERATION_COORDINATOR.idFromName(spotifyId));
    const response = await stub.fetch(`https://coordinator/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId, ttlMs: 1_800_000 })
    });
    if (!response.ok) throw new Error(`Generation coordinator returned ${response.status}`);
    return response.json() as Promise<{ acquired?: boolean; owns?: boolean; renewed?: boolean; released?: boolean }>;
};
