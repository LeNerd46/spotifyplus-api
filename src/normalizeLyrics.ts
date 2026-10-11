import type { Lyrics } from './types';

// Mutates only backing-vocal boundary text; timings and lead vocals stay intact.
export function removeBackgroundParentheses(lyrics: Lyrics): boolean {
    if (lyrics.Type !== 'Syllable') return false;

    let changed = false;
    for (const entry of lyrics.Content) {
        if (entry.Type !== 'Vocal') continue;
        for (const background of entry.Background ?? []) {
            const first = background.Syllables[0];
            const last = background.Syllables.at(-1);
            if (!first || !last) continue;

            const firstText = first.Text.replace(/^\(+/, '');
            if (firstText !== first.Text) {
                first.Text = firstText;
                changed = true;
            }
            const lastText = last.Text.replace(/\)+$/, '');
            if (lastText !== last.Text) {
                last.Text = lastText;
                changed = true;
            }
        }
    }
    return changed;
}
