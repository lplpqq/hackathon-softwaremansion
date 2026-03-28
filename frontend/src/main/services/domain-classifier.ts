import { DomainClassification } from "../types";

const NEWS_DOMAINS = [
  "bbc.com",
  "bbc.co.uk",
  "cnbc.com",
  "cnn.com",
  "reuters.com",
  "apnews.com",
  "nytimes.com",
  "theguardian.com",
  "foxnews.com",
  "nbcnews.com",
  "abcnews.go.com",
  "politico.com",
];

const VIDEO_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "twitch.tv",
  "vimeo.com"
];

function matchesDomain(hostname: string, pattern: string): boolean {
  return hostname === pattern || hostname.endsWith("." + pattern);
}

function matchesAny(hostname: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesDomain(hostname, p));
}

export function classifyDomain(urlStr: string): DomainClassification {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return {
      domain: "",
      isNewsDomain: false,
      isVideoDomain: false,
      isSupportedDomain: false,
    };
  }

  const hostname = url.hostname.toLowerCase();
  let isNewsDomain = matchesAny(hostname, NEWS_DOMAINS);
  const isVideoDomain = matchesAny(hostname, VIDEO_DOMAINS);

  // Specific rule for BBC: only trigger if it's an article (/news/articles/)
  if (
    isNewsDomain &&
    (hostname.endsWith("bbc.com") || hostname.endsWith("bbc.co.uk"))
  ) {
    if (!url.pathname.includes("/news/articles/")) {
      isNewsDomain = false;
    }
  }

  return {
    domain: hostname,
    isNewsDomain,
    isVideoDomain,
    isSupportedDomain: isNewsDomain || isVideoDomain,
  };
}
