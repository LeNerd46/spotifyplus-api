import { launch } from '@cloudflare/playwright';

interface Env {
    BROWSER: Fetcher;
    APPLE_CACHE: KVNamespace;
}

export async function getAppleMusicToken(env: Env): Promise<String> {
    const cachedToken = await env.APPLE_CACHE.get('apple-developer-token');

    if (cachedToken) return cachedToken;

    const token = await getAppleMusicTokenFromWebsite(env);

    const expiration = getJwtExpiration(token);
    const refreshAt = expiration - 60 * 5;

    await env.APPLE_CACHE.put('apple-developer-token', token, {
        expiration: refreshAt
    });

    return token;
}

async function getAppleMusicTokenFromWebsite(env: Env): Promise<string> {
    const browser = await launch(env.BROWSER);

    try {
        const page = await browser.newPage();

        page.on('console', message => {
            console.log(`[browser] ${message.type()}: ${message.text()}`);
        });

        page.on('pageerror', error => {
            console.error('[browser error]', error);
        });

        await page.goto('https://music.apple.com/us/new', {
            waitUntil: 'domcontentloaded'
        });

        await page.waitForFunction(() => {
            //@ts-ignore
            const win = window as any;

            return !!win.MusicKit?.getInstance()?.developerToken;
        }, { timeout: 15000 });

        return await page.evaluate(() => {
            //@ts-ignore
            return (window as any).MusicKit.getInstance().developerToken;
        });
    } finally {
        try {
            await browser.close();
        } catch { }
    }
}

function getJwtExpiration(token: string): number {
    const payload = token.split('.')[1];
    if (!payload) return 10;

    const decoded = JSON.parse(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    );

    if (typeof decoded.exp !== 'number') {
        throw new Error('JWT does not contain an exp claim');
    }

    return decoded.exp;
}