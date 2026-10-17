import { Context } from 'hono';
import { getSpotifyTrack, SpotifyMetadataError } from '../spotify/metadata';
import { getMonochromeStream, MonochromeError } from '../monochrome';

export const Download = async (c: Context<{ Bindings: Env }>) => {
    const id = c.req.param('id') ?? c.req.query('id') ?? '';
    const nativeId = id.replace(/^(?:tracks|mono):(?:track:)?/, '');

    if (!/^[a-zA-Z0-9]{22}$/.test(id) && !/^\d{17,20}$/.test(nativeId)) return c.json({ error: 'Provide a Spotify track ID or a Monochrome track ID' }, 400);
    const redirect = c.req.query('redirect');
    if (redirect !== undefined && !['true', 'false'].includes(redirect)) return c.json({ error: 'redirect must be true or false' }, 400);

    c.header('Cache-Control', 'no-store');

    try {
        const track = /^\d{17,20}$/.test(nativeId) ? nativeId : await getSpotifyTrack(c.env, id);
        const stream = await getMonochromeStream(track, c.env.MONOCHROME_API_URL);

        if (redirect === 'true') return c.redirect(stream.url, 302);
        return c.json(stream);
    } catch (error) {
        if (error instanceof SpotifyMetadataError || error instanceof MonochromeError) {
            const status = error.status === 400 ? 400 : error.status === 404 ? 404 : error.status === 503 ? 503 : 502;
            return c.json({ error: error.message }, status);
        }
        console.error('Track resolution failed:', error instanceof Error ? error.message : error);
        return c.json({ error: 'Unable to resolve track audio' }, 502);
    }
};
