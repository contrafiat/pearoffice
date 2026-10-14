import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'
import { v1_0_1 } from './v1_0_1'
import { v1_0_0 } from './v1_0_0'
import { v0_1_0 } from './v0_1_0'

export const versionGraph = VersionGraph.of({
  current,
  other: [v1_0_1, v1_0_0, v0_1_0],
})
