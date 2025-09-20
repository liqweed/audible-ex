# audible-ex

> Enhance your Audible experience with Goodreads ratings, smart filters, and powerful book discovery tools. Supports multiple Audible regions including UK, US, Canada, Australia, and India.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/EXTENSION_ID)](https://chrome.google.com/webstore)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## ✨ Features

### 🌟 Rating Integration
- **Goodreads ratings** displayed directly on Audible pages
- **Visual highlighting** for highly-rated books (>4.2 stars)
- **Rating breakdowns** on hover with star distribution
- **Review counts** to gauge popularity

### 🔍 Smart Filtering
- Filter by **minimum rating** (1.0 - 5.0 stars)
- Filter by **rating count** for statistical significance  
- **Tag-based filtering** using Goodreads shelves/genres
- **Visual dimming** of filtered books for easy scanning

### 🌍 Multi-Region Support (v1.1+)
- Works on **Audible.co.uk** (UK)
- Works on **Audible.com** (US) 
- Works on **Audible.ca** (Canada)
- Works on **Audible.com.au** (Australia)
- Works on **Audible.in** (India)
- Automatic region detection
- Per-region settings and cache

### ⚡ Performance
- **Intelligent caching** of last 1000 books per region
- **Rate-limited scraping** to respect source websites
- **Batch processing** for efficient page enhancement
- **Non-blocking UI** updates

### 📚 Enhanced Pages
Works seamlessly on:
- Book detail pages
- Search results
- Category browsing
- Daily deals & sales
- Your library
- Wishlist
- Plus catalog (where available)

## 🚀 Installation

### From Chrome Web Store (Recommended)
1. Visit [Chrome Web Store](https://chrome.google.com/webstore)
2. Click "Add to Chrome"
3. Navigate to your preferred Audible site and enjoy!

### From Source (Development)
```bash
# Clone repository
git clone https://github.com/yourusername/audible-ex.git
cd audible-ex

# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Load dist/ folder as unpacked extension in Chrome
```

## 🎯 Quick Start

1. **Install the extension** from Chrome Web Store
2. **Visit any supported Audible site** - ratings appear automatically
3. **Click the extension icon** to access filters
4. **Hover over ratings** to see detailed breakdowns
5. **Configure settings** to personalize your experience

## ⚙️ Configuration

Access settings by clicking the extension icon:

### Global Settings
| Setting | Description | Default |
|---------|-------------|---------|
| **Rating Source** | Choose between Goodreads, StoryGraph, etc. | Goodreads |
| **Highlight Threshold** | Books above this are highlighted | 4.2 stars |
| **Cache Size** | Number of books to cache per region | 1000 |
| **Request Delay** | Time between API requests | 1 second |

### Per-Region Settings
| Setting | Description | Default |
|---------|-------------|---------|
| **Minimum Rating** | Hide books below this rating | 3.0 stars |
| **Minimum Reviews** | Ensure statistical significance | 100 reviews |
| **Active Tags** | Filter by these tags | None |
| **Region Enabled** | Enable/disable for specific region | Enabled |

## 🌐 Supported Regions

### Currently Supported (v1.1)
- 🇬🇧 **United Kingdom** - audible.co.uk
- 🇺🇸 **United States** - audible.com
- 🇨🇦 **Canada** - audible.ca
- 🇦🇺 **Australia** - audible.com.au
- 🇮🇳 **India** - audible.in

### Planned Support
- 🇩🇪 Germany - audible.de
- 🇫🇷 France - audible.fr
- 🇮🇹 Italy - audible.it
- 🇪🇸 Spain - audible.es
- 🇯🇵 Japan - audible.co.jp

## 🛠️ Development

### Prerequisites
- Node.js 18+
- npm or pnpm
- Chrome browser

### Tech Stack
- **WXT** - Chrome extension framework
- **React 18** - UI components
- **TypeScript** - Type safety
- **Zustand** - State management
- **TanStack Query** - Data fetching
- **Tailwind CSS** - Styling
- **Shadcn/ui** - UI components

### Project Structure
```
audible-ex/
├── docs/               # Documentation
│   ├── PRD.md         # Product requirements
│   └── ARCHITECTURE.md # Technical architecture
├── entrypoints/        # Extension entry points
│   ├── background.ts   # Service worker
│   ├── content/        # Content scripts
│   └── popup/          # Extension popup
├── src/
│   ├── components/     # React components
│   ├── domains/        # Region-specific configs
│   ├── services/       # Business logic
│   ├── storage/        # Storage management
│   └── types/          # TypeScript types
└── wxt.config.ts       # WXT configuration
```

### Commands
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build extension
npm run build

# Run tests
npm run test

# Test specific region
npm run test:domain -- --domain=audible.com

# Lint code
npm run lint

# Format code
npm run format
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Quick Contribution Guide
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Adding Support for New Regions
1. Add domain configuration in `src/domains/`
2. Update selectors for the new region
3. Test thoroughly on the target site
4. Submit PR with test results

## 📝 Roadmap

### Version 1.0 (Current MVP)
- ✅ Goodreads integration
- ✅ Basic filtering
- ✅ Caching system
- ✅ Rate limiting
- ✅ Audible UK support

### Version 1.1 (In Development)
- [ ] Multi-region support (US, CA, AU, IN)
- [ ] Alternative sources (StoryGraph, Hardcover)
- [ ] Series detection
- [ ] Duration filtering
- [ ] Grid view support

### Version 2.0 (Future)
- [ ] AI-powered recommendations
- [ ] Profile imports
- [ ] Export functionality
- [ ] Community features
- [ ] Cross-region price comparison

## 🐛 Known Issues

- Rating lookup may fail for books with special characters
- Some box sets don't have ISBN mappings
- Grid view enhancement pending (MVP focuses on list view)
- Regional exclusive books may not have Goodreads data

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- Inspired by the [Goodreads Ratings for Audible](https://greasyfork.org/en/scripts/371584) userscript
- Thanks to all contributors and beta testers
- Book data courtesy of Goodreads (scraped respectfully)

## 💬 Support

- **Bug Reports**: [GitHub Issues](https://github.com/yourusername/audible-ex/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/yourusername/audible-ex/discussions)
- **Questions**: [FAQ](docs/FAQ.md)

## ⚠️ Disclaimer

This extension is not affiliated with Audible, Amazon, or Goodreads. It's an independent project created to enhance the user experience. Please use responsibly and respect the terms of service of all platforms involved.

---

<p align="center">
  Made with ❤️ for audiobook lovers everywhere
</p>