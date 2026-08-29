export type StartupRoute = '/about' | '/discover'

interface StartupRouteConfig {
  hasSeenProjectIntro(): boolean
  markProjectIntroSeen(): void
}

export function resolveStartupRoute(
  config: StartupRouteConfig,
  onPersistenceError?: (error: unknown) => void,
): StartupRoute {
  if (config.hasSeenProjectIntro()) return '/discover'
  try {
    config.markProjectIntroSeen()
  } catch (error) {
    onPersistenceError?.(error)
  }
  return '/about'
}
