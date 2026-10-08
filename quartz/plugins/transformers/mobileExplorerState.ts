import type { QuartzTransformerPlugin } from "../types"

const mobileExplorerStateScript = `
function collapseMobileExplorer() {
  if (!window.matchMedia("(max-width: 800px)").matches) return

  for (const explorer of document.querySelectorAll(".explorer")) {
    if (explorer.hasAttribute("aria-expanded")) continue
    explorer.classList.add("collapsed")
    explorer.setAttribute("aria-expanded", "false")
  }
  document.documentElement.classList.remove("mobile-no-scroll")
}

collapseMobileExplorer()
document.addEventListener("nav", collapseMobileExplorer)
document.addEventListener("render", collapseMobileExplorer)
`

export const MobileExplorerState: QuartzTransformerPlugin = () => ({
  name: "MobileExplorerState",
  externalResources() {
    return {
      js: [
        {
          script: mobileExplorerStateScript,
          contentType: "inline",
          loadTime: "afterDOMReady",
        },
      ],
    }
  },
})
