import { fromHono } from "chanfana";
import { Hono } from "hono";
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";
import { GetLyrics } from "./endpoints/getLyrics";
import { SubmitLyrics } from "./endpoints/submitLyrics";
import { bodyLimit } from 'hono/body-limit';

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

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

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
