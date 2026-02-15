import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export interface FetchedContent {
    title: string;
    content: string;
    url: string;
    byline?: string;
}

/**
 * Fetch a URL and extract readable content using Readability + linkedom.
 * Returns clean article text without noisy headers/footers/scripts.
 */
export async function fetchAndExtract(url: string, timeoutMs: number = 15_000): Promise<FetchedContent> {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ClaudeConductor/1.0)',
            'Accept': 'text/html,application/xhtml+xml,text/plain',
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();

    // For non-HTML content, return as-is
    if (!contentType.includes('html')) {
        return { title: url, content: text, url };
    }

    // Parse HTML and extract readable content
    const { document } = parseHTML(text);
    const reader = new Readability(document);
    const article = reader.parse();

    if (article) {
        return {
            title: article.title ?? url,
            content: (article.textContent ?? '').trim(),
            url,
            byline: article.byline || undefined,
        };
    }

    // Fallback: return body text if Readability couldn't parse
    const body = document.querySelector('body');
    return {
        title: document.title || url,
        content: body?.textContent?.trim() ?? text,
        url,
    };
}
