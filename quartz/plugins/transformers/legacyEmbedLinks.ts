import type { Element, Root } from "hast"
import type { QuartzTransformerPlugin } from "../types"
import { visit } from "unist-util-visit"

const embedLabel = "Bekijk ingesloten media"

interface Embed {
  src: string
  kind: string
  title: string
  allow?: string
}

function textContent(node: Element): string {
  return node.children
    .map((child) => {
      if (child.type === "text") return child.value
      if (child.type === "element") return textContent(child)
      return ""
    })
    .join("")
    .trim()
}

function youtubeEmbed(url: URL): Embed | undefined {
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  if (!["youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host)) return

  const segments = url.pathname.split("/").filter(Boolean)
  let videoId: string | null = null
  if (host === "youtu.be") {
    videoId = segments[0] ?? null
  } else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) {
    videoId = segments[1] ?? null
  } else {
    videoId = url.searchParams.get("v")
  }

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return

  const params = new URLSearchParams({ rel: "0" })
  const playlist = url.searchParams.get("list")
  const start = url.searchParams.get("start") ?? url.searchParams.get("t")
  if (playlist && /^[\w-]+$/.test(playlist)) params.set("list", playlist)
  if (start) {
    const seconds = start.match(/^\d+/)?.[0]
    if (seconds) params.set("start", seconds)
  }

  return {
    src: `https://www.youtube-nocookie.com/embed/${videoId}?${params}`,
    kind: "youtube",
    title: "YouTube-video",
    allow:
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
  }
}

function knownIframeEmbed(url: URL): Embed | undefined {
  const host = url.hostname.toLowerCase()
  const pathname = url.pathname.toLowerCase()

  if (host === "datawrapper.dwcdn.net") {
    return { src: url.href, kind: "datawrapper", title: "Interactieve grafiek" }
  }
  if (host === "open.spotify.com" && pathname.startsWith("/embed/")) {
    return {
      src: url.href,
      kind: "spotify",
      title: "Spotify",
      allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    }
  }
  if (host === "player.vimeo.com") {
    return {
      src: url.href,
      kind: "video",
      title: "Vimeo-video",
      allow: "autoplay; fullscreen; picture-in-picture",
    }
  }
  if (host === "w.soundcloud.com" && pathname.startsWith("/player")) {
    return { src: url.href, kind: "audio", title: "SoundCloud", allow: "autoplay" }
  }
  if (host === "www.instagram.com" && pathname.includes("/embed")) {
    return { src: url.href, kind: "social", title: "Instagram-bericht" }
  }
  if (host === "platform.twitter.com" && pathname.startsWith("/embed/")) {
    return { src: url.href, kind: "social", title: "Bericht op X" }
  }
  if (host === "www.linkedin.com" && pathname.startsWith("/embed/")) {
    return { src: url.href, kind: "social", title: "LinkedIn-bericht" }
  }
}

function resolveEmbed(href: string): Embed | undefined {
  try {
    const url = new URL(href)
    if (url.protocol !== "https:" && url.protocol !== "http:") return
    return youtubeEmbed(url) ?? knownIframeEmbed(url)
  } catch {
    return
  }
}

function iframe(embed: Embed): Element {
  return {
    type: "element",
    tagName: "iframe",
    properties: {
      src: embed.src,
      title: embed.title,
      className: ["external-embed", embed.kind],
      loading: "lazy",
      frameBorder: "0",
      allowFullScreen: true,
      referrerPolicy: "strict-origin-when-cross-origin",
      ...(embed.allow ? { allow: embed.allow } : {}),
    },
    children: [],
  }
}

const embedStyles = `
.external-embed {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 1rem 0;
  border: 0;
  border-radius: 5px;
  background-color: var(--lightgray);
}

.external-embed.youtube,
.external-embed.video {
  aspect-ratio: 16 / 9;
  height: auto;
}

.external-embed.datawrapper,
.external-embed.social {
  min-height: 32rem;
}

.external-embed.spotify,
.external-embed.audio {
  min-height: 22rem;
}
`

export const LegacyEmbedLinks: QuartzTransformerPlugin = () => ({
  name: "LegacyEmbedLinks",
  htmlPlugins() {
    return [
      () => (tree: Root) => {
        visit(tree, "element", (node: Element, index, parent) => {
          if (node.tagName !== "a" || textContent(node) !== embedLabel) return
          const href = node.properties?.href
          if (typeof href !== "string") return
          const embed = resolveEmbed(href)
          if (!embed || index === undefined || parent === undefined) return
          parent.children[index] = iframe(embed)
        })
      },
    ]
  },
  externalResources() {
    return { css: [{ content: embedStyles, inline: true }] }
  },
})
