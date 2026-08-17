import { describe, it, expect } from 'vitest';
import { extractProductJson, parseHtmlPage, buildExtractionPrompt } from '../importer';

describe('extractProductJson', () => {
  it('parses plain JSON objects', () => {
    const out = extractProductJson('{"title":"Dog Bed","sellingPrice":49.99}');
    expect(out?.title).toBe('Dog Bed');
    expect(out?.sellingPrice).toBe(49.99);
  });

  it('parses markdown-fenced JSON', () => {
    const raw = 'Here you go:\n```json\n{"title":"Cat Toy","category":"Pet Toys"}\n```\nEnjoy!';
    const out = extractProductJson(raw);
    expect(out?.title).toBe('Cat Toy');
    expect(out?.category).toBe('Pet Toys');
  });

  it('parses fenced JSON without the json tag', () => {
    const raw = '```\n{"title":"Harness"}\n```';
    expect(extractProductJson(raw)?.title).toBe('Harness');
  });

  it('returns null on garbage', () => {
    expect(extractProductJson('no json here at all')).toBeNull();
    expect(extractProductJson('')).toBeNull();
    expect(extractProductJson('{invalid json}')).toBeNull();
  });
});

describe('parseHtmlPage', () => {
  it('extracts title, description, images and strips scripts/styles', () => {
    const html = [
      '<html><head>',
      '<meta property="og:title" content="Premium Pet Bed" />',
      '<meta property="og:description" content="A cozy bed" />',
      '</head><body>',
      '<script>var secret = 1;</script>',
      '<style>.x{color:red}</style>',
      '<img src="https://cdn.example.com/a.jpg" />',
      '<img data-src="https://cdn.example.com/b.webp" />',
      '<nav>Nav junk</nav>',
      '<p>Soft and supportive memory foam.</p>',
      '</body></html>',
    ].join('');
    const { text, images } = parseHtmlPage(html);
    expect(text).toContain('Premium Pet Bed');
    expect(text).toContain('Soft and supportive memory foam.');
    expect(text).not.toContain('var secret');
    expect(text).not.toContain('color:red');
    expect(images).toContain('https://cdn.example.com/a.jpg');
    expect(images).toContain('https://cdn.example.com/b.webp');
  });

  it('extracts markdown images from plain text', () => {
    const { images } = parseHtmlPage('See this ![product](https://img.example.com/x.png) and ![y](https://img.example.com/y.jpeg)');
    expect(images).toContain('https://img.example.com/x.png');
  });
});

describe('buildExtractionPrompt', () => {
  it('includes the content and instructs against inventing facts', () => {
    const prompt = buildExtractionPrompt('The bed is 40 inches wide.', 'text');
    expect(prompt).toContain('The bed is 40 inches wide.');
    expect(prompt).toContain('never invent factual specifications');
  });
});
