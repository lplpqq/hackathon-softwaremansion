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
  let hostname: string;
  let pathname: string;
  try {
    const url = new URL(urlStr);
    hostname = url.hostname.toLowerCase();
    pathname = url.pathname.toLowerCase();
  } catch {
    return {
      domain: "",
      isNewsDomain: false,
      isVideoDomain: false,
      isSupportedDomain: false,
    };
  }

  let isNewsDomain = matchesAny(hostname, NEWS_DOMAINS);
  const isVideoDomain = matchesAny(hostname, VIDEO_DOMAINS);

  // Specialized check for CNBC: Only count as news if it's an article (ends in .html)
  if (matchesDomain(hostname, "cnbc.com")) {
    const isArticle = pathname.endsWith(".html");
    if (!isArticle) {
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
