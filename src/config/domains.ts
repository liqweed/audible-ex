import { DomainConfig, Region } from '../types/domain'

const commonSelectors = {
  bookTitle:
    '[data-testid="product-title"], h1.bc-heading, h1[data-automation="title"]',
  bookAuthor:
    '[data-testid="author-name"], .authorLabel a, a.bc-link.bc-color-link',
  bookASIN: '[data-asin]',
  bookPrice:
    '.buybox-regular-price, .adblp-price, span.bc-text.bc-size-base.bc-color-base',
  bookCover: '.bc-image-inset-border img, img[data-testid="product-image"]',
  listContainer: '.adbl-impression-container, .productListItem',
  gridContainer: '.bc-container.bc-spacing-top-none.bc-spacing-s3',
}

export const DOMAIN_CONFIGS: Record<string, DomainConfig> = {
  'audible.co.uk': {
    domain: 'audible.co.uk',
    region: 'UK',
    selectors: commonSelectors,
    currency: 'GBP',
    currencySymbol: '£',
    dateFormat: 'DD/MM/YYYY',
    features: {
      plusCatalog: true,
      whispersync: true,
      sales: true,
    },
  },
  'audible.com': {
    domain: 'audible.com',
    region: 'US',
    selectors: commonSelectors,
    currency: 'USD',
    currencySymbol: '$',
    dateFormat: 'MM/DD/YYYY',
    features: {
      plusCatalog: true,
      whispersync: true,
      sales: true,
    },
  },
  'audible.ca': {
    domain: 'audible.ca',
    region: 'CA',
    selectors: commonSelectors,
    currency: 'CAD',
    currencySymbol: '$',
    dateFormat: 'DD/MM/YYYY',
    features: {
      plusCatalog: true,
      whispersync: true,
      sales: true,
    },
  },
  'audible.com.au': {
    domain: 'audible.com.au',
    region: 'AU',
    selectors: commonSelectors,
    currency: 'AUD',
    currencySymbol: '$',
    dateFormat: 'DD/MM/YYYY',
    features: {
      plusCatalog: true,
      whispersync: true,
      sales: true,
    },
  },
  'audible.in': {
    domain: 'audible.in',
    region: 'IN',
    selectors: commonSelectors,
    currency: 'INR',
    currencySymbol: '₹',
    dateFormat: 'DD/MM/YYYY',
    features: {
      plusCatalog: false,
      whispersync: false,
      sales: true,
    },
  },
}

export const SUPPORTED_DOMAINS = Object.keys(DOMAIN_CONFIGS)

export const getConfigByRegion = (region: Region): DomainConfig | undefined => {
  return Object.values(DOMAIN_CONFIGS).find(config => config.region === region)
}
