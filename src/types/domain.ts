export type Region = 'UK' | 'US' | 'CA' | 'AU' | 'IN'

export interface DomainSelectors {
  bookTitle: string
  bookAuthor: string
  bookASIN: string
  bookPrice: string
  bookCover: string
  listContainer: string
  gridContainer: string
}

export interface DomainFeatures {
  plusCatalog: boolean
  whispersync: boolean
  sales: boolean
}

export interface DomainConfig {
  domain: string
  region: Region
  selectors: DomainSelectors
  currency: string
  currencySymbol: string
  dateFormat: string
  features: DomainFeatures
}

export interface IDomainDetector {
  getCurrentDomain(): string
  getRegion(): Region
  isSupported(): boolean
  getDomainConfig(): DomainConfig
  validateDomain(domain: string): boolean
}
