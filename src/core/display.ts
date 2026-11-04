/** The default appearance, shared without bringing storage or React into the badge code. */
export const DEFAULT_DISPLAY = {
  labels: 4,
  year: true,
  overview: true,
} as const

export interface DisplaySettings {
  readonly labels: number
  readonly year: boolean
  readonly overview: boolean
}
