import { fromHono } from "chanfana";
import { Hono } from "hono";
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";
import { GetLyrics } from "./endpoints/getLyrics";
import { SubmitLyrics } from "./endpoints/submitLyrics";
import { ReportLyrics } from "./endpoints/reportLyrics";
import { bodyLimit } from 'hono/body-limit';

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', async (c, next) => {
	if (c.req.method === 'OPTIONS') {
		return next();
	}

	const ip = c.req.header('CF-Connecting-IP');

	if (!ip) {
		return c.json({ error: 'Unable to get IP address' }, 400);
	}

	const overall = await c.env.API_RATE_LIMITER.limit({ key: `ip:${ip}` });

	if (!overall.success) {
		c.header('Retry-After', '60');
		c.header('Cache-Control', 'no-store');

		return c.json({ error: 'Too many requests' }, 429);
	}

	const isSubmission = c.req.method === 'POST' && /^\/api\/lyrics\/[^/]+\/?$/.test(c.req.path);
	if (isSubmission) {
		const submission = await c.env.SUBMIT_RATE_LIMITER.limit({
			key: `ip:${ip}`
		});

		if (!submission.success) {
			c.header('Retry-After', '60');
			c.header('Cache-Control', 'no-store');

			return c.json({ error: 'Too many requests' }, 429);
		}
	}

	await next();
});

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);

openapi.get('/api/lyrics/:id', GetLyrics);
app.post('/api/lyrics/:id', bodyLimit({ maxSize: 512 * 1024, onError: c => c.json({ error: 'Lyrics payload too large' }, 413) }), SubmitLyrics);
app.post('/api/lyrics/:id/reports', bodyLimit({ maxSize: 8 * 1024, onError: c => c.json({ error: 'Report payload too large' }, 413) }), ReportLyrics);

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
