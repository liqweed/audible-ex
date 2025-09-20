import { DomainConfig, IDomainDetector, Region } from '../types/domain'
import { DOMAIN_CONFIGS, SUPPORTED_DOMAINS } from '../config/domains'

export class DomainDetector implements IDomainDetector {
  private static instance: DomainDetector
  private cachedDomain: string | null = null
  private cachedConfig: DomainConfig | null = null

  private constructor() {}

  public static getInstance(): DomainDetector {
    if (!DomainDetector.instance) {
      DomainDetector.instance = new DomainDetector()
    }
    return DomainDetector.instance
  }

  public getCurrentDomain(): string {
    if (this.cachedDomain) {
      return this.cachedDomain
    }

    const hostname = this.getHostname()
    this.cachedDomain = this.extractDomain(hostname)
    return this.cachedDomain
  }

  public getRegion(): Region {
    const config = this.getDomainConfig()
    return config.region
  }

  public isSupported(): boolean {
    const domain = this.getCurrentDomain()
    return this.validateDomain(domain)
  }

  public getDomainConfig(): DomainConfig {
    if (this.cachedConfig) {
      return this.cachedConfig
    }

    const domain = this.getCurrentDomain()
    const config = DOMAIN_CONFIGS[domain]

    if (!config) {
      throw new Error(
        `Unsupported domain: ${domain}. Supported domains are: ${SUPPORTED_DOMAINS.join(', ')}`
      )
    }

    this.cachedConfig = config
    return config
  }

  public validateDomain(domain: string): boolean {
    return SUPPORTED_DOMAINS.includes(domain)
  }

  public clearCache(): void {
    this.cachedDomain = null
    this.cachedConfig = null
  }

  private getHostname(): string {
    if (typeof window !== 'undefined' && window.location) {
      return window.location.hostname
    }

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      return ''
    }

    return ''
  }

  private extractDomain(hostname: string): string {
    const wwwPrefix = 'www.'
    if (hostname.startsWith(wwwPrefix)) {
      return hostname.substring(wwwPrefix.length)
    }
    return hostname
  }

  public static async detectFromTab(tabId?: number): Promise<string> {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      throw new Error('Chrome API not available')
    }

    return new Promise((resolve, reject) => {
      const callback = (tab: chrome.tabs.Tab) => {
        if (!tab.url) {
          reject(new Error('No URL available for tab'))
          return
        }

        try {
          const url = new URL(tab.url)
          const detector = DomainDetector.getInstance()
          const domain = detector.extractDomain(url.hostname)
          resolve(domain)
        } catch (error) {
          reject(error)
        }
      }

      if (tabId !== undefined) {
        chrome.tabs.get(tabId, callback)
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs.length === 0) {
            reject(new Error('No active tab found'))
            return
          }
          callback(tabs[0])
        })
      }
    })
  }
}

export const domainDetector = DomainDetector.getInstance()
