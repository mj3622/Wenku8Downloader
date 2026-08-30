const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseRootPackageVersion(rootPackage) {
  const version = rootPackage?.version
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error('Root package version must be a valid stable semver')
  }
  return version
}
