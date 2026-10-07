import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { LegacyEmbedLinks } from "./quartz/plugins/transformers/legacyEmbedLinks"

const config = await loadQuartzConfig()
config.plugins.transformers.push(LegacyEmbedLinks())
export default config
export const layout = await loadQuartzLayout()
