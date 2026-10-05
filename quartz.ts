import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { registerCondition } from "./quartz/plugins/loader/conditions"

registerCondition("index", (props) => props.fileData.slug === "index")
registerCondition("dated", (props) => {
  const frontmatter = props.fileData.frontmatter
  return Boolean(frontmatter?.published || frontmatter?.created || frontmatter?.modified)
})

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
