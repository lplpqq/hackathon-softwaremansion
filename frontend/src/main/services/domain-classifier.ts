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

export function classifyDomain(url: string): DomainClassification {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return {
      domain: "",
      isNewsDomain: false,
      isVideoDomain: false,
      isSupportedDomain: false,
    };
  }

  const isNewsDomain = matchesAny(hostname, NEWS_DOMAINS);
  const isVideoDomain = matchesAny(hostname, VIDEO_DOMAINS);

  return {
    domain: hostname,
    isNewsDomain,
    isVideoDomain,
    isSupportedDomain: isNewsDomain || isVideoDomain,
  };
}
