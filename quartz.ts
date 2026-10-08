import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { LegacyEmbedLinks } from "./quartz/plugins/transformers/legacyEmbedLinks"
import { MobileExplorerState } from "./quartz/plugins/transformers/mobileExplorerState"

const config = await loadQuartzConfig()
config.plugins.transformers.push(LegacyEmbedLinks())
config.plugins.transformers.push(MobileExplorerState())
export default config
export const layout = await loadQuartzLayout()
