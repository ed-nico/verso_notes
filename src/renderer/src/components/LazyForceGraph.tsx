import { lazy, type ComponentType } from 'react'

/**
 * react-force-graph (+ its d3 dependencies) is ~0.4 MB and only needed when the
 * Graph view or the local-graph panel actually renders. Loading it lazily keeps
 * it out of the initial bundle. Consumers must render it inside a <Suspense>.
 *
 * React.lazy can't carry the component's generic node/link types, so the export
 * is typed loosely (props were already inferred via the lib's generics before).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = lazy(() => import('react-force-graph-2d')) as unknown as ComponentType<any>
export default ForceGraph2D
