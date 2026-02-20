# ChatterMatter

Track changes and comments for Markdown — portable, AI-native, and independent of any platform.

## What Is This?

ChatterMatter is a structured format for embedding comments, suggestions, questions, and review feedback directly inside Markdown files. Comments are stored as JSON in fenced code blocks, so they:

- **Travel with the file** — no external database, no platform lock-in
- **Degrade gracefully** — in any Markdown renderer, comments appear as inert code blocks
- **Survive every pipeline** — anything that preserves code fences preserves your comments
- **Support typed feedback** — questions, suggestions, approvals, AI feedback, reactions
- **Enable threaded conversations** — full threading via parent ID references
- **Preserve decision history** — resolved comments stay in the file as an audit trail

## Example

A ChatterMatter block inside a Markdown document:

````markdown
```chattermatter
{
  "id": "c1",
  "type": "suggestion",
  "author": "alice",
  "timestamp": "2026-02-20T10:30:00Z",
  "anchor": { "type": "text", "exact": "introduces the idea" },
  "content": "Consider using 'establishes the concept' for stronger phrasing.",
  "status": "open"
}
```
````

## Project Status

**Pre-implementation.** The format specification is under review. See:

- [`docs/spec/spec-review.md`](docs/spec/spec-review.md) — Technical review of the v0.1 spec
- [`docs/business-case/product-vision.md`](docs/business-case/product-vision.md) — Product strategy and insights
- [`docs/business-case/market-research.md`](docs/business-case/market-research.md) — Market landscape and user behavior research

## Documentation

```
docs/
├── business-case/
│   ├── product-vision.md    # Product strategy, five key insights, three product shapes
│   └── market-research.md   # Competitive landscape, user behavior patterns
└── spec/
    └── spec-review.md       # Technical review with 14 identified issues
```

## Development

This repo uses the [Align](https://github.com/floatingsidewal/align) scaffolding framework for structured development. See `CLAUDE.md` for development guidance.

## License

MIT
