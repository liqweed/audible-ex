# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

audible-ex is a Chrome extension built with WXT framework that enhances Audible browsing by integrating Goodreads ratings and advanced filtering capabilities. It supports multiple Audible regions (UK, US, Canada, Australia, India) with region-specific configurations.

## Common Development Commands

### Development
```bash
# Start development server with hot reload
npm run dev

# Development for Firefox
npm run dev:firefox
```

### Building
```bash
# Build for production
npm run build

# Build for Firefox
npm run build:firefox

# Create distribution zip
npm run zip

# Create Firefox distribution zip
npm run zip:firefox
```

### Type Checking
```bash
# Type check without emitting files
npm run compile
```

### Setup
```bash
# Install dependencies and prepare WXT
npm install
```

## Tech Stack & Architecture

### Core Technologies
- **WXT** - Chrome extension framework with Vite and HMR
- **React 18** - UI components
- **TypeScript** - Type safety
- **Manifest V3** - Chrome extension standard

### Project Structure
```
audible-ex/
├── entrypoints/        # Extension entry points
│   ├── background.ts   # Service worker
│   ├── content.ts      # Content script
│   └── popup/          # Extension popup UI
├── docs/              # Documentation
│   ├── PRD.md         # Product requirements
│   └── ARCHITECTURE.md # Technical architecture
├── public/            # Static assets
├── assets/            # Extension assets
└── wxt.config.ts      # WXT configuration
```

### Key Architectural Concepts

**Multi-Domain Support**: The extension is designed to work across multiple Audible regions with domain-specific configurations and separate caches per region.

**Content Script Architecture**: Uses a layered approach with domain abstraction for region-specific selectors and behaviors.

**Rate Limiting**: Implements intelligent rate limiting with exponential backoff to respect external services.

**Caching Strategy**: Local caching with LRU eviction, 7-day TTL, and region separation (1000 books per domain).

## Development Notes

### WXT Framework
- Uses modern Chrome extension framework with Vite
- Provides hot module replacement for development
- Handles Manifest V3 service worker complexities
- Auto-generates extension manifest

### Extension Structure
- **Background Script**: Service worker for rate limiting and queue management
- **Content Script**: Main functionality injected into Audible pages
- **Popup**: Extension settings and filter UI

### Region Support
The extension supports multiple Audible domains through a domain abstraction layer that handles region-specific selectors, currency formats, and features.

### Performance Considerations
- Intelligent caching system to minimize external API calls
- Rate limiting to respect external services
- Lazy loading and progressive enhancement
- Non-blocking UI updates

## Testing Commands

No specific test commands are defined in package.json. Based on the architecture documentation, testing should cover:
- Unit tests for service layer logic
- Integration tests for content script injection
- E2E tests for full user workflows
- Regional testing across supported domains