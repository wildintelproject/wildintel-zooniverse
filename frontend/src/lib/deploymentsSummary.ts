import type { TrapperSelection } from '../types'

/** "All deployments" or "N deployment(s)", with the images they hold when
 * every one of them says how many. */
export function deploymentsSummary(selection: TrapperSelection): string {
  const { deployments, all_deployments: all } = selection
  const text = all ? 'all deployments' : `${deployments.length} deployment(s)`
  if (!deployments.every((d) => d.image_count != null)) return text
  const images = deployments.reduce((sum, d) => sum + (d.image_count ?? 0), 0)
  return `${text} · ${images.toLocaleString()} images`
}
