/**
 * API utilities for the Audible Extension
 * Handles communication with Goodreads API and other external services
 */

export interface GoodreadsData {
  rating: number
  ratingsCount: number
  reviewsCount: number
  url: string
}

export interface BookSearchParams {
  title: string
  author: string
  isbn?: string
}

/**
 * Rate limiting configuration
 */
export const RATE_LIMITS = {
  goodreads: {
    requestsPerSecond: 1,
    burstLimit: 5,
  },
}

/**
 * Fetch Goodreads data for a book
 * This would typically go through the background script for rate limiting
 */
export async function fetchGoodreadsData(
  params: BookSearchParams
): Promise<GoodreadsData | null> {
  try {
    // In a real implementation, this would send a message to the background script
    // which would handle the actual API call with rate limiting
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_GOODREADS_DATA',
      payload: params,
    })

    if (response.success) {
      return response.data as GoodreadsData
    }

    return null
  } catch (error) {
    console.error('Failed to fetch Goodreads data:', error)
    return null
  }
}

/**
 * Extract book information from Audible page
 */
export function extractBookInfo(element: Element): BookSearchParams | null {
  try {
    // This would contain the actual selectors for different Audible regions
    const titleElement = element.querySelector('[data-test-id="book-title"]')
    const authorElement = element.querySelector('[data-test-id="author-name"]')

    if (!titleElement || !authorElement) {
      return null
    }

    return {
      title: titleElement.textContent?.trim() || '',
      author: authorElement.textContent?.trim() || '',
    }
  } catch (error) {
    console.error('Failed to extract book info:', error)
    return null
  }
}

/**
 * Inject rating display into Audible page
 */
export function injectRatingDisplay(
  targetElement: Element,
  goodreadsData: GoodreadsData
): void {
  try {
    // Remove existing rating if present
    const existing = targetElement.querySelector('.audible-ex-rating')
    if (existing) {
      existing.remove()
    }

    // Create rating element
    const ratingElement = document.createElement('div')
    ratingElement.className = 'audible-ex-rating'
    ratingElement.innerHTML = `
      <div class="flex items-center gap-2 mt-2 p-2 bg-green-50 rounded border border-green-200">
        <span class="text-sm font-medium text-green-800">Goodreads:</span>
        <span class="text-sm text-green-700">${goodreadsData.rating.toFixed(1)} ⭐</span>
        <span class="text-xs text-green-600">(${goodreadsData.ratingsCount.toLocaleString()} ratings)</span>
      </div>
    `

    targetElement.appendChild(ratingElement)
  } catch (error) {
    console.error('Failed to inject rating display:', error)
  }
}
