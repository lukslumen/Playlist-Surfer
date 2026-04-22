import { normalizeColumnName, resolveChannelId, resolveChannelName, resolveVideoId } from './data';
import type {
  LinkingBaseBucket,
  LinkingDomainOverride,
  LinkingDomainAuditRecord,
  LinkingGeneratedRowMetadata,
  LinkingMentionAuditRecord,
  LinkingRowAuditRecord,
  LinkingSourceCandidateProfile,
} from '../types';

export type LinkingStrategyColumn = 'cross-platform' | 'intra-platform' | 'marketplace' | 'crowdfunding' | 'routing';

export interface LinkingSummary {
  linkedRows: number;
  totalUrls: number;
  uniqueDomains: number;
  avgUrlsPerRow: number;
  avgDomainsPerRow: number;
  shortenerShare: number;
  malformedShare: number;
}

export interface LinkingBarMetric {
  key: string;
  label: string;
  share: number;
}

export interface LinkingMatrixCell {
  column: LinkingStrategyColumn;
  share: number;
}

export interface LinkingMatrixRow {
  label: string;
  linkedRows: number;
  cells: LinkingMatrixCell[];
}

export interface LinkingRecipeCard {
  recipe: string;
  typicalStructure: string;
  share: number;
  avgDomains: number;
  signatureDomains: string;
}

export interface LinkingDomainRow {
  rank: number;
  domain: string;
  mentions: number;
  rows: number;
  intensity: number;
  ecology: LinkingBaseBucket;
}

export interface LinkingDashboardModel {
  summary: LinkingSummary;
  matrixSubtitle: string;
  matrixColumns: LinkingStrategyColumn[];
  matrixRows: LinkingMatrixRow[];
  baseEcology: LinkingBarMetric[];
  recipes: LinkingRecipeCard[];
  topDomains: LinkingDomainRow[];
  hasLinkedRows: boolean;
  sourceColumn: string;
}

export interface LinkingColumnCandidate {
  column: string;
  score: number;
  reason: string;
}

export interface LinkingBuildOptions {
  linkColumn: string;
}

export interface LinkingParseMention {
  rowId: string;
  category: string;
  rawUrl: string;
  normalizedUrl: string;
  domain: string;
  malformed: boolean;
  shortener: boolean;
  baseBucket: LinkingBaseBucket;
  reason: string;
}

export interface LinkingParsedRow {
  rowId: string;
  videoId: string | null;
  category: string;
  mentions: LinkingParseMention[];
}

export interface LinkingStageAResult {
  sourceColumn: string;
  datasetFingerprint: string;
  stageAFingerprint: string;
  parsedRows: LinkingParsedRow[];
  totalRows: number;
}

export interface LinkingStageBResult {
  model: LinkingDashboardModel;
  mentionAudit: LinkingMentionAuditRecord[];
  domainAudit: LinkingDomainAuditRecord[];
  rowAudit: LinkingRowAuditRecord[];
  generatedMetadataByVideoId: Record<string, LinkingGeneratedRowMetadata>;
}

export interface LinkingStageBOptions {
  sourceColumn: string;
  overridesByDomain?: Record<string, LinkingDomainOverride>;
}

export interface LinkingBuildProgressUpdate {
  completed: number;
  total: number;
  detail: string;
}

const TRAILING_PUNCTUATION = /[),.;!?]+$/;
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>'"`]+/gi;
const BARE_DOMAIN_REGEX = /\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|gg|ly|tv|me|to|ca|de|uk|app|store|shop|fm|bio|link|xyz|cc|site)(?:\/[^\s<>'"`]*)?/gi;
const URLISH_VALUE_REGEX = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|co|ai|gg|ly|tv|me|to|ca|de|uk|app|store|shop|fm|bio|link|xyz|cc|site)\b)/i;
const MAX_URL_SCAN_TEXT_LENGTH = 20000;
const MAX_URLS_PER_ROW = 80;
const LINKING_ASYNC_CHUNK_SIZE = 250;

const SHORTENER_DOMAINS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'ow.ly',
  'buff.ly',
  'cutt.ly',
  'rb.gy',
  'rebrand.ly',
  'tiny.cc',
  'shorturl.at',
  'is.gd',
  'soo.gd',
  's2r.co',
]);

type DomainClassification = {
  bucket: LinkingBaseBucket;
  reason: string;
};

const DOMAIN_RULES: Record<string, DomainClassification> = {
  'youtube.com': { bucket: 'intra-platform', reason: 'Matched YouTube owned ecosystem rule.' },
  'youtu.be': { bucket: 'intra-platform', reason: 'Matched YouTube short-link rule.' },
  'instagram.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'facebook.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'fb.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'twitter.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'x.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'tiktok.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'linkedin.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'pinterest.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'reddit.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'discord.gg': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'discord.com': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'threads.net': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'telegram.me': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  't.me': { bucket: 'cross-platform', reason: 'Matched social platform rule.' },
  'patreon.com': { bucket: 'crowdfunding', reason: 'Matched crowdfunding support rule.' },
  'buymeacoffee.com': { bucket: 'crowdfunding', reason: 'Matched crowdfunding support rule.' },
  'ko-fi.com': { bucket: 'crowdfunding', reason: 'Matched crowdfunding support rule.' },
  'kickstarter.com': { bucket: 'crowdfunding', reason: 'Matched crowdfunding support rule.' },
  'gofundme.com': { bucket: 'crowdfunding', reason: 'Matched crowdfunding support rule.' },
  'amazon.com': { bucket: 'marketplace', reason: 'Matched marketplace commerce rule.' },
  'amazon.de': { bucket: 'marketplace', reason: 'Matched marketplace commerce rule.' },
  'amazon.co.uk': { bucket: 'marketplace', reason: 'Matched marketplace commerce rule.' },
  'etsy.com': { bucket: 'marketplace', reason: 'Matched marketplace commerce rule.' },
  'shopify.com': { bucket: 'marketplace', reason: 'Matched marketplace commerce rule.' },
  'spotify.com': { bucket: 'marketplace', reason: 'Matched marketplace commerce rule.' },
  'gumroad.com': { bucket: 'marketplace', reason: 'Matched hybrid marketplace-support rule.' },
  'stan.store': { bucket: 'marketplace', reason: 'Matched commerce routing rule.' },
  'amzn.to': { bucket: 'marketplace', reason: 'Matched commerce routing rule.' },
  'linktr.ee': { bucket: 'routing', reason: 'Matched bio-link routing rule.' },
  'beacons.ai': { bucket: 'routing', reason: 'Matched bio-link routing rule.' },
  'bio.site': { bucket: 'routing', reason: 'Matched bio-link routing rule.' },
  'carrd.co': { bucket: 'routing', reason: 'Matched bio-link routing rule.' },
  'lnk.bio': { bucket: 'routing', reason: 'Matched bio-link routing rule.' },
  'hoo.be': { bucket: 'routing', reason: 'Matched bio-link routing rule.' },
  'solo.to': { bucket: 'routing', reason: 'Matched bio-link routing rule.' },
};

const MATRIX_COLUMNS: LinkingStrategyColumn[] = ['cross-platform', 'intra-platform', 'marketplace', 'crowdfunding', 'routing'];



export function normalizeLinkingDomainKey(value: string): string {
  const text = String(value || '').trim().toLowerCase();
  return normalizeDomain(text);
}

function clampUrlText(value: string) {
  return value.length > MAX_URL_SCAN_TEXT_LENGTH ? value.slice(0, MAX_URL_SCAN_TEXT_LENGTH) : value;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    window.setTimeout(() => resolve(), 0);
  });
}

export function applyLinkingDomainOverride(args: {
  overridesByDomain: Record<string, LinkingDomainOverride>;
  domain: string;
  baseBucket?: LinkingBaseBucket | null;
  note?: string;
  updatedAt?: string;
}) {
  const domain = normalizeLinkingDomainKey(args.domain);
  const previous = args.overridesByDomain[domain];
  const note = typeof args.note === 'string' ? args.note.trim() : previous?.note?.trim();
  const next: LinkingDomainOverride = {
    domain,
    updatedAt: args.updatedAt || new Date().toISOString(),
    ...(args.baseBucket ? { baseBucket: args.baseBucket } : previous?.baseBucket ? { baseBucket: previous.baseBucket } : {}),
    ...(note ? { note } : {}),
  };
  const shouldRemove = !next.baseBucket && !note;
  const overridesByDomain = { ...args.overridesByDomain };
  if (shouldRemove) {
    delete overridesByDomain[domain];
    return { domain, previous, next: undefined, overridesByDomain };
  }
  overridesByDomain[domain] = next;
  return { domain, previous, next, overridesByDomain };
}

export function revertLinkingDomainOverride(args: {
  overridesByDomain: Record<string, LinkingDomainOverride>;
  domain: string;
}) {
  const domain = normalizeLinkingDomainKey(args.domain);
  const overridesByDomain = { ...args.overridesByDomain };
  const previous = overridesByDomain[domain];
  delete overridesByDomain[domain];
  return { domain, previous, next: undefined, overridesByDomain };
}

export function buildChannelLinkingSnapshot(args: {
  rows: any[];
  generatedMetadataByVideoId: Record<string, LinkingGeneratedRowMetadata>;
}) {
  return {
    generatedAt: new Date().toISOString(),
    datasetFingerprint: `${args.rows.length}:${Object.keys(args.generatedMetadataByVideoId).length}`,
    rowUniverseCount: args.rows.length,
    byChannelKey: aggregateChannelLinkingFromVideoRows({
      videoRows: args.rows,
      generatedMetadataByVideoId: args.generatedMetadataByVideoId,
    }),
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeDomain(hostname: string): string {
  let domain = hostname.toLowerCase().replace(/^www\./, '');
  if (domain.endsWith('.instagram.com')) domain = 'instagram.com';
  if (domain.endsWith('.facebook.com')) domain = 'facebook.com';
  if (domain.endsWith('.youtube.com')) domain = 'youtube.com';
  if (domain.endsWith('.tiktok.com')) domain = 'tiktok.com';
  if (domain.endsWith('.x.com')) domain = 'x.com';
  if (domain.endsWith('.twitter.com')) domain = 'twitter.com';
  if (domain.endsWith('.reddit.com')) domain = 'reddit.com';
  if (domain.endsWith('.pinterest.com')) domain = 'pinterest.com';
  return domain;
}

function classifyDomain(domain: string): DomainClassification {
  if (DOMAIN_RULES[domain]) return DOMAIN_RULES[domain];
  if (SHORTENER_DOMAINS.has(domain)) {
    return { bucket: 'routing', reason: 'Matched known URL shortener rule.' };
  }
  if (domain === 'unknown') {
    return { bucket: 'other', reason: 'Malformed or unparsable URL fallback.' };
  }
  return { bucket: 'other', reason: 'Fallback classification (unmapped domain).' };
}

function trimUrlCandidate(value: string): string {
  return value.trim().replace(TRAILING_PUNCTUATION, '');
}

function isLikelyPromoLikeToken(value: string): boolean {
  const trimmed = trimUrlCandidate(value);
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('www.') || trimmed.includes('.')) return false;
  if (!/^[A-Z0-9-]{4,32}$/i.test(trimmed)) return false;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  const alphaCount = (trimmed.match(/[A-Z]/ig) || []).length;
  return alphaCount >= 2 && digitCount >= 1;
}

function looksLikeValidUrlCandidate(value: string): boolean {
  const trimmed = trimUrlCandidate(value);
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (isLikelyPromoLikeToken(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('www.')) return true;
  return /(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|gg|ly|tv|me|to|ca|de|uk|app|store|shop|fm|bio|link|xyz|cc|site)(?:\/[^\s<>'"`]*)?$/i.test(trimmed);
}

function containsPromoCodeContext(text: string, candidate: string): boolean {
  if (!candidate || /^https?:\/\//i.test(candidate) || candidate.startsWith('www.')) return false;
  const needle = candidate.toLowerCase();
  const source = clampUrlText(String(text || '')).toLowerCase();
  const index = source.indexOf(needle);
  if (index === -1) return false;
  const around = source.slice(Math.max(0, index - 18), Math.min(source.length, index + needle.length + 18));
  return /\b(promo|code|coupon|discount|use code)\b/.test(around);
}

function parseExtractedUrlsRaw(value: unknown): string[] {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const accepted = new Set<string>();
  const pushValue = (entry: unknown) => {
    const trimmed = trimUrlCandidate(String(entry).replace(/^"|"$/g, ''));
    if (!looksLikeValidUrlCandidate(trimmed)) return;
    const normalized = normalizeUrlCandidate(trimmed);
    if (normalized.malformed || normalized.domain === 'unknown') return;
    accepted.add(trimmed);
  };
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      parsed.slice(0, MAX_URLS_PER_ROW * 2).forEach(pushValue);
      return [...accepted].slice(0, MAX_URLS_PER_ROW);
    }
  } catch {
    // fall through
  }
  const bounded = clampUrlText(text).replace(/^\[|\]$/g, '');
  bounded
    .split(/[\n,;|]+/)
    .slice(0, MAX_URLS_PER_ROW * 2)
    .forEach(pushValue);
  return [...accepted].slice(0, MAX_URLS_PER_ROW);
}

function extractUrlsFromText(text: string): string[] {
  const set = new Set<string>();
  const bounded = clampUrlText(text);
  for (const match of bounded.matchAll(URL_REGEX)) {
    const value = trimUrlCandidate(match[0]);
    if (!looksLikeValidUrlCandidate(value) || containsPromoCodeContext(bounded, value)) continue;
    set.add(value);
    if (set.size >= MAX_URLS_PER_ROW) break;
  }
  if (set.size < MAX_URLS_PER_ROW) {
    for (const match of bounded.matchAll(BARE_DOMAIN_REGEX)) {
      const value = trimUrlCandidate(match[0]);
      if (!value || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('www.')) continue;
      if (!looksLikeValidUrlCandidate(value) || containsPromoCodeContext(bounded, value)) continue;
      const normalized = normalizeUrlCandidate(value);
      if (normalized.malformed || normalized.domain === 'unknown') continue;
      set.add(`https://${value}`);
      if (set.size >= MAX_URLS_PER_ROW) break;
    }
  }
  return [...set];
}

function normalizeUrlCandidate(value: string): { domain: string; normalizedUrl: string; malformed: boolean } {
  const trimmed = trimUrlCandidate(value);
  if (!trimmed) return { domain: 'unknown', normalizedUrl: '', malformed: true };
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith('www.')
      ? `https://${trimmed}`
      : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    const domain = normalizeDomain(parsed.hostname);
    return {
      domain,
      normalizedUrl: `${parsed.protocol}//${domain}${parsed.pathname}${parsed.search}`.toLowerCase(),
      malformed: false,
    };
  } catch {
    return { domain: 'unknown', normalizedUrl: trimmed.toLowerCase(), malformed: true };
  }
}

function resolveRowId(row: any, index: number): string {
  return resolveVideoId(row) || `${String(row?.channelId || row?.channelTitle || 'row')}-${index}`;
}

function resolveCategory(row: any): string {
  const value = row?.videoCategoryLabel ?? row?.video_category_label ?? row?.category ?? row?.videoCategory ?? '';
  const text = String(value ?? '').trim();
  return text || 'unknown';
}

function shouldPreferStructuredParsing(columnName: string, text: string) {
  const normalized = normalizeColumnName(columnName);
  if (/url|link|domain/.test(normalized) && !/description|text|notes/.test(normalized)) return true;
  if (text.includes('http://') || text.includes('https://') || text.includes('www.')) return true;
  if (text.includes(',') && URLISH_VALUE_REGEX.test(text)) return true;
  return false;
}

function extractUrlsFromConfiguredColumn(row: any, columnName: string) {
  const rawValue = row?.[columnName];
  const text = String(rawValue ?? '').trim();
  if (!text) return [];
  const normalizedColumn = normalizeColumnName(columnName);
  const preferStructured = shouldPreferStructuredParsing(columnName, text);
  const isNarrativeField = /description|notes|caption|transcript|about|summary/.test(normalizedColumn);
  const primary = preferStructured ? parseExtractedUrlsRaw(rawValue) : extractUrlsFromText(text);
  const fallback = preferStructured
    ? extractUrlsFromText(text)
    : isNarrativeField
      ? []
      : parseExtractedUrlsRaw(rawValue);
  return unique([...primary, ...fallback].map((item) => trimUrlCandidate(String(item))).filter((item) => looksLikeValidUrlCandidate(item))).slice(0, MAX_URLS_PER_ROW);
}

function classifyRecipe(args: { mentions: LinkingParseMention[]; domains: string[] }) {
  const hasCrossPlatform = args.mentions.some((mention) => mention.baseBucket === 'cross-platform');
  const hasIntraPlatform = args.mentions.some((mention) => mention.baseBucket === 'intra-platform');
  const hasMarketplace = args.mentions.some((mention) => mention.baseBucket === 'marketplace');
  const hasCrowdfunding = args.mentions.some((mention) => mention.baseBucket === 'crowdfunding');
  const hasRouting = args.mentions.some((mention) => mention.baseBucket === 'routing');
  const hasSocial = hasCrossPlatform || hasIntraPlatform;

  if (hasSocial && !hasMarketplace && !hasCrowdfunding && !hasRouting) {
    return { name: 'social-only', structure: 'cross/intra-platform destinations only' };
  }
  if (hasSocial && hasCrowdfunding && hasRouting) {
    return { name: 'creator stack', structure: 'social + crowdfunding + routing' };
  }
  if (hasMarketplace && args.domains.length >= 3) {
    return { name: 'commerce cluster', structure: 'multiple marketplace destinations' };
  }
  if (hasRouting && hasIntraPlatform) {
    return { name: 'hub-first', structure: 'routing hub plus intra-platform destination' };
  }
  if (hasSocial && hasMarketplace && hasRouting) {
    return { name: 'streaming relay', structure: 'social to marketplace relay' };
  }
  return { name: 'mixed routing', structure: 'mixed outbound strategies' };
}

function signatureDomains(domains: string[]): string {
  const counts = new Map<string, number>();
  domains.forEach((domain) => counts.set(domain, (counts.get(domain) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([domain]) => domain)
    .join(', ');
}

function buildDatasetFingerprint(rows: any[], sourceColumn: string): string {
  const rowIds = rows.slice(0, 20).map((row, index) => resolveRowId(row, index));
  const tailIds = rows.slice(Math.max(0, rows.length - 20)).map((row, index) => resolveRowId(row, index));
  const token = `${sourceColumn}|${rows.length}|${rowIds.join(',')}|${tailIds.join(',')}`;
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return `${rows.length}:${Math.abs(hash)}`;
}

function applyDomainOverride(
  domain: string,
  classification: DomainClassification,
  overridesByDomain?: Record<string, LinkingDomainOverride>,
) {
  const normalizedDomain = normalizeLinkingDomainKey(domain);
  const override = overridesByDomain?.[normalizedDomain];
  const unmapped = classification.reason.toLowerCase().includes('fallback');
  if (!override) return {
    classification,
    overridden: false,
    currentReason: classification.reason,
    autoReason: classification.reason,
    classificationSource: 'auto' as const,
    unmapped,
    overrideNote: undefined,
    updatedAt: undefined,
  };
  const overrideNote = override.note?.trim();
  const currentReason = overrideNote ? `Manual override: ${overrideNote}` : 'Manual override';
  return {
    classification: {
      ...classification,
      bucket: override.baseBucket || classification.bucket,
      reason: currentReason,
    },
    overridden: true,
    currentReason,
    autoReason: classification.reason,
    classificationSource: 'manual' as const,
    unmapped,
    overrideNote,
    updatedAt: override.updatedAt,
  };
}

export function profileLinkingColumnCandidates(rows: any[]): LinkingSourceCandidateProfile[] {
  if (!rows.length) return [];
  const sampleRows = rows.slice(0, 300);
  const columnNames = unique(sampleRows.flatMap((row) => Object.keys(row || {})));

  const candidates = columnNames.map((column) => {
    const normalized = normalizeColumnName(column);
    let score = 0;
    const reasons: string[] = [];
    if (/extractedurls|outboundurls|urls/.test(normalized)) {
      score += 130;
      reasons.push('column name strongly suggests extracted URLs');
    } else if (/url|link/.test(normalized)) {
      score += 76;
      reasons.push('column name suggests links or URLs');
    } else if (/domain/.test(normalized)) {
      score += 62;
      reasons.push('column name suggests domain data');
    } else if (/description|text/.test(normalized)) {
      score += 24;
      reasons.push('column may contain embedded links in free text');
    }

    let nonEmptyRows = 0;
    let urlishRows = 0;
    let estimatedUrlMentions = 0;
    const samples: string[] = [];
    for (const row of sampleRows) {
      const value = row?.[column];
      const text = String(value ?? '').trim();
      if (!text) continue;
      nonEmptyRows += 1;
      if (URLISH_VALUE_REGEX.test(text)) {
        urlishRows += 1;
        estimatedUrlMentions += Math.max(1, extractUrlsFromConfiguredColumn(row, column).length);
        score += text.length > 180 ? 4 : 8;
      }
      if (text.startsWith('[') && text.endsWith(']')) score += 4;
      if (samples.length < 4) {
        samples.push(text.length > 120 ? `${text.slice(0, 117)}...` : text);
      }
    }

    if (urlishRows > 0) {
      reasons.push(`${urlishRows} sampled rows looked URL-like`);
      score += Math.min(72, urlishRows * 6);
    }
    if (nonEmptyRows === 0) score = 0;

    return {
      column,
      score,
      reason: reasons.join('; ') || 'available column',
      nonEmptyRows,
      urlishRows,
      urlishShare: ratio(urlishRows, nonEmptyRows),
      estimatedUrlMentions,
      sampleValues: samples,
    } satisfies LinkingSourceCandidateProfile;
  })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.column.localeCompare(b.column));

  if (candidates.length) return candidates;
  return columnNames.slice(0, 6).map((column) => ({
    column,
    score: 1,
    reason: 'available column',
    nonEmptyRows: 0,
    urlishRows: 0,
    urlishShare: 0,
    estimatedUrlMentions: 0,
    sampleValues: [],
  }));
}

export function detectLinkingColumnCandidates(rows: any[]): LinkingColumnCandidate[] {
  return profileLinkingColumnCandidates(rows).map((candidate) => ({
    column: candidate.column,
    score: candidate.score,
    reason: candidate.reason,
  }));
}

export function buildLinkingStageA(rows: any[], options: LinkingBuildOptions): LinkingStageAResult {
  const parsedRows: LinkingParsedRow[] = [];
  rows.forEach((row, index) => {
    const rowId = resolveRowId(row, index);
    const category = resolveCategory(row);
    const candidateUrls = extractUrlsFromConfiguredColumn(row, options.linkColumn);
    if (!candidateUrls.length) return;
    const mentions = candidateUrls.map((candidate) => {
      const normalized = normalizeUrlCandidate(candidate);
      const classification = classifyDomain(normalized.domain);
      return {
        rowId,
        category,
        rawUrl: candidate,
        normalizedUrl: normalized.normalizedUrl,
        domain: normalized.domain,
        malformed: normalized.malformed,
        shortener: SHORTENER_DOMAINS.has(normalized.domain),
        baseBucket: classification.bucket,
        reason: classification.reason,
      } satisfies LinkingParseMention;
    });
    parsedRows.push({
      rowId,
      videoId: resolveVideoId(row),
      category,
      mentions,
    });
  });

  const datasetFingerprint = buildDatasetFingerprint(rows, options.linkColumn);
  const stageAFingerprint = `${datasetFingerprint}:${options.linkColumn}:${parsedRows.length}`;
  return {
    sourceColumn: options.linkColumn,
    datasetFingerprint,
    stageAFingerprint,
    parsedRows,
    totalRows: rows.length,
  };
}

export function buildLinkingStageB(stageA: LinkingStageAResult, options: LinkingStageBOptions): LinkingStageBResult {
  const allMentions: LinkingParseMention[] = [];
  const linkedRowsById = new Map<string, LinkingParsedRow>();
  const mentionAudit: LinkingMentionAuditRecord[] = [];
  const domainStats = new Map<string, {
    domain: string;
    mentions: number;
    rows: Set<string>;
    autoBaseBucket: LinkingBaseBucket;
    currentBaseBucket: LinkingBaseBucket;
    autoReason: string;
    currentReason: string;
    overridden: boolean;
    unmapped: boolean;
    classificationSource: 'auto' | 'manual';
    overrideNote?: string;
    updatedAt?: string;
  }>();

  stageA.parsedRows.forEach((parsedRow) => {
    const mentionList: LinkingParseMention[] = [];
    parsedRow.mentions.forEach((mention) => {
      const baseClassification = classifyDomain(mention.domain);
      const overridden = applyDomainOverride(mention.domain, baseClassification, options.overridesByDomain);
      const resolvedMention: LinkingParseMention = {
        ...mention,
        baseBucket: overridden.classification.bucket || mention.baseBucket,
        reason: overridden.currentReason,
      };
      mentionList.push(resolvedMention);
      allMentions.push(resolvedMention);
      mentionAudit.push({
        rowId: resolvedMention.rowId,
        category: resolvedMention.category,
        rawUrl: resolvedMention.rawUrl,
        normalizedUrl: resolvedMention.normalizedUrl,
        domain: resolvedMention.domain,
        baseBucket: resolvedMention.baseBucket,
        autoAssigned: !overridden.overridden,
        reason: overridden.currentReason,
        malformed: resolvedMention.malformed,
        shortener: resolvedMention.shortener,
      });
      if (resolvedMention.domain === 'unknown') return;
      const existing = domainStats.get(resolvedMention.domain) || {
        domain: resolvedMention.domain,
        mentions: 0,
        rows: new Set<string>(),
        autoBaseBucket: baseClassification.bucket || resolvedMention.baseBucket,
        currentBaseBucket: resolvedMention.baseBucket,
        autoReason: overridden.autoReason,
        currentReason: overridden.currentReason,
        overridden: overridden.overridden,
        unmapped: overridden.unmapped,
        classificationSource: overridden.classificationSource,
        overrideNote: overridden.overrideNote,
        updatedAt: overridden.updatedAt,
      };
      existing.mentions += 1;
      existing.rows.add(resolvedMention.rowId);
      existing.autoBaseBucket = baseClassification.bucket || existing.autoBaseBucket;
      existing.currentBaseBucket = resolvedMention.baseBucket;
      existing.autoReason = overridden.autoReason;
      existing.currentReason = overridden.currentReason;
      existing.overridden = overridden.overridden;
      existing.unmapped = overridden.unmapped;
      existing.classificationSource = overridden.classificationSource;
      existing.overrideNote = overridden.overrideNote;
      existing.updatedAt = overridden.updatedAt;
      domainStats.set(resolvedMention.domain, existing);
    });
    if (mentionList.length) {
      linkedRowsById.set(parsedRow.rowId, { ...parsedRow, mentions: mentionList });
    }
  });

  const linkedRows = linkedRowsById.size;
  const totalUrls = allMentions.length;
  const uniqueDomains = new Set(allMentions.filter((mention) => !mention.malformed).map((mention) => mention.domain)).size;
  const shortenerShare = ratio(allMentions.filter((mention) => mention.shortener).length, totalUrls);
  const malformedShare = ratio(allMentions.filter((mention) => mention.malformed).length, totalUrls);
  const avgUrlsPerRow = ratio(totalUrls, linkedRows);
  const avgDomainsPerRow = linkedRows
    ? [...linkedRowsById.values()].reduce((sum, linkedRow) => sum + new Set(linkedRow.mentions.map((mention) => mention.domain)).size, 0) / linkedRows
    : 0;

  const baseCounts: Record<LinkingBaseBucket, number> = {
    'cross-platform': 0,
    'intra-platform': 0,
    marketplace: 0,
    crowdfunding: 0,
    routing: 0,
    other: 0,
  };

  allMentions.forEach((mention) => {
    baseCounts[mention.baseBucket] += 1;
  });

  const topDomains = [...domainStats.values()]
    .map((stats) => ({
      rank: 0,
      domain: stats.domain,
      mentions: stats.mentions,
      rows: stats.rows.size,
      intensity: ratio(stats.mentions, stats.rows.size),
      ecology: stats.currentBaseBucket,
    }))
    .sort((a, b) => b.mentions - a.mentions || b.rows - a.rows || a.domain.localeCompare(b.domain))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const recipeBuckets = new Map<string, { rows: number; domains: number[]; domainMentions: string[]; structure: string }>();
  const rowAudit: LinkingRowAuditRecord[] = [];

  linkedRowsById.forEach((linkedRow) => {
    const recipe = classifyRecipe({ mentions: linkedRow.mentions, domains: linkedRow.mentions.map((mention) => mention.domain) });
    const entry = recipeBuckets.get(recipe.name) ?? { rows: 0, domains: [], domainMentions: [], structure: recipe.structure };
    entry.rows += 1;
    entry.domains.push(new Set(linkedRow.mentions.map((mention) => mention.domain)).size);
    for (const mention of linkedRow.mentions) {
      entry.domainMentions.push(mention.domain);
    }
    recipeBuckets.set(recipe.name, entry);
    rowAudit.push({
      rowId: linkedRow.rowId,
      recipe: recipe.name,
      baseLabels: unique(linkedRow.mentions.map((mention) => mention.baseBucket)),
      domains: unique(linkedRow.mentions.map((mention) => mention.domain)),
      urlCount: linkedRow.mentions.length,
    });
  });

  const recipes = [...recipeBuckets.entries()]
    .map(([recipe, entry]) => ({
      recipe,
      typicalStructure: entry.structure,
      share: ratio(entry.rows, linkedRows),
      avgDomains: entry.domains.length ? entry.domains.reduce((sum, value) => sum + value, 0) / entry.domains.length : 0,
      signatureDomains: signatureDomains(entry.domainMentions),
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 8);

  const categoryBuckets = new Map<string, LinkingParsedRow[]>();
  linkedRowsById.forEach((linkedRow) => {
    const bucket = categoryBuckets.get(linkedRow.category) ?? [];
    bucket.push(linkedRow);
    categoryBuckets.set(linkedRow.category, bucket);
  });

  const matrixRows = [...categoryBuckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, linkedItems]) => {
      const linkedCount = linkedItems.length;
      const cells: LinkingMatrixCell[] = MATRIX_COLUMNS.map((column) => {
        const count = linkedItems.filter((item) => {
          return item.mentions.some((mention) => mention.baseBucket === column);
        }).length;
        return { column, share: ratio(count, linkedCount) };
      });
      return { label, linkedRows: linkedCount, cells };
    });

  const generatedMetadataByVideoId: Record<string, LinkingGeneratedRowMetadata> = {};
  stageA.parsedRows.forEach((parsedRow) => {
    const mentionList = linkedRowsById.get(parsedRow.rowId)?.mentions ?? [];
    if (!parsedRow.videoId) return;
    const baseLabels = unique(mentionList.map((mention) => mention.baseBucket));
    const domains = unique(mentionList.filter((mention) => mention.domain && mention.domain !== 'unknown').map((mention) => mention.domain));
    const recipe = mentionList.length
      ? classifyRecipe({ mentions: mentionList, domains: mentionList.map((mention) => mention.domain) }).name
      : 'none';
    generatedMetadataByVideoId[parsedRow.videoId] = {
      linking_linked: mentionList.length ? 'yes' : 'no',
      linking_url_count: mentionList.length,
      linking_domain_count: domains.length,
      linking_base_labels: baseLabels,
      linking_recipe: recipe,
      linking_top_domains: domains.slice(0, 5),
      linking_malformed_count: mentionList.filter((mention) => mention.malformed).length,
      linking_shortener_count: mentionList.filter((mention) => mention.shortener).length,
      linking_raw_links: unique(mentionList.map((mention) => mention.normalizedUrl).filter(Boolean)),
      linking_raw_domains: domains,
    };
  });

  const domainAudit = [...domainStats.values()]
    .map((entry) => ({
      domain: entry.domain,
      mentions: entry.mentions,
      rows: entry.rows.size,
      autoBaseBucket: entry.autoBaseBucket,
      currentBaseBucket: entry.currentBaseBucket,
      baseBucket: entry.currentBaseBucket,
      autoReason: entry.autoReason,
      currentReason: entry.currentReason,
      reason: entry.currentReason,
      overridden: entry.overridden,
      unmapped: entry.unmapped,
      classificationSource: entry.classificationSource,
      overrideNote: entry.overrideNote,
      updatedAt: entry.updatedAt,
    }))
    .sort((a, b) => b.mentions - a.mentions || a.domain.localeCompare(b.domain));

  return {
    model: {
      summary: {
        linkedRows,
        totalUrls,
        uniqueDomains,
        avgUrlsPerRow,
        avgDomainsPerRow,
        shortenerShare,
        malformedShare,
      },
      matrixSubtitle: 'Top 5 video categories by linked-row volume',
      matrixColumns: MATRIX_COLUMNS,
      matrixRows,
      baseEcology: [
        { key: 'cross-platform', label: 'cross-platform', share: ratio(baseCounts['cross-platform'], totalUrls) },
        { key: 'intra-platform', label: 'intra-platform', share: ratio(baseCounts['intra-platform'], totalUrls) },
        { key: 'marketplace', label: 'marketplace', share: ratio(baseCounts.marketplace, totalUrls) },
        { key: 'crowdfunding', label: 'crowdfunding', share: ratio(baseCounts.crowdfunding, totalUrls) },
        { key: 'routing', label: 'routing', share: ratio(baseCounts.routing, totalUrls) },
        { key: 'other', label: 'other', share: ratio(baseCounts.other, totalUrls) },
      ],
      recipes,
      topDomains,
      hasLinkedRows: linkedRows > 0,
      sourceColumn: options.sourceColumn,
    },
    mentionAudit,
    domainAudit,
    rowAudit,
    generatedMetadataByVideoId,
  };
}


export async function buildLinkingStageAAsync(
  rows: any[],
  options: LinkingBuildOptions,
  onProgress?: (progress: LinkingBuildProgressUpdate) => void,
): Promise<LinkingStageAResult> {
  const parsedRows: LinkingParsedRow[] = [];
  const totalRows = Math.max(rows.length, 1);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowId = resolveRowId(row, index);
    const category = resolveCategory(row);
    const candidateUrls = extractUrlsFromConfiguredColumn(row, options.linkColumn);
    if (candidateUrls.length) {
      const mentions = candidateUrls.map((candidate) => {
        const normalized = normalizeUrlCandidate(candidate);
        const classification = classifyDomain(normalized.domain);
        return {
          rowId,
          category,
          rawUrl: candidate,
          normalizedUrl: normalized.normalizedUrl,
          domain: normalized.domain,
          malformed: normalized.malformed,
          shortener: SHORTENER_DOMAINS.has(normalized.domain),
          baseBucket: classification.bucket,
          reason: classification.reason,
        } satisfies LinkingParseMention;
      });
      parsedRows.push({
        rowId,
        videoId: resolveVideoId(row),
        category,
        mentions,
      });
    }

    const nextCompleted = index + 1;
    if (onProgress && (nextCompleted === rows.length || nextCompleted % LINKING_ASYNC_CHUNK_SIZE === 0)) {
      onProgress({
        completed: nextCompleted,
        total: totalRows,
        detail: `Parsing URLs from row ${nextCompleted.toLocaleString()} of ${rows.length.toLocaleString()}`,
      });
      await yieldToBrowser();
    }
  }

  const datasetFingerprint = buildDatasetFingerprint(rows, options.linkColumn);
  const stageAFingerprint = `${datasetFingerprint}:${options.linkColumn}:${parsedRows.length}`;
  return {
    sourceColumn: options.linkColumn,
    datasetFingerprint,
    stageAFingerprint,
    parsedRows,
    totalRows: rows.length,
  };
}

export async function buildLinkingStageBAsync(
  stageA: LinkingStageAResult,
  options: LinkingStageBOptions,
  onProgress?: (progress: LinkingBuildProgressUpdate) => void,
): Promise<LinkingStageBResult> {
  const allMentions: LinkingParseMention[] = [];
  const linkedRowsById = new Map<string, LinkingParsedRow>();
  const mentionAudit: LinkingMentionAuditRecord[] = [];
  const domainStats = new Map<string, {
    domain: string;
    mentions: number;
    rows: Set<string>;
    autoBaseBucket: LinkingBaseBucket;
    currentBaseBucket: LinkingBaseBucket;
    autoReason: string;
    currentReason: string;
    overridden: boolean;
    unmapped: boolean;
    classificationSource: 'auto' | 'manual';
    overrideNote?: string;
    updatedAt?: string;
  }>();

  const totalRows = Math.max(stageA.parsedRows.length, 1);
  for (let index = 0; index < stageA.parsedRows.length; index += 1) {
    const parsedRow = stageA.parsedRows[index];
    const mentionList: LinkingParseMention[] = [];
    parsedRow.mentions.forEach((mention) => {
      const baseClassification = classifyDomain(mention.domain);
      const overridden = applyDomainOverride(mention.domain, baseClassification, options.overridesByDomain);
      const resolvedMention: LinkingParseMention = {
        ...mention,
        baseBucket: overridden.classification.bucket || mention.baseBucket,
        reason: overridden.currentReason,
      };
      mentionList.push(resolvedMention);
      allMentions.push(resolvedMention);
      mentionAudit.push({
        rowId: resolvedMention.rowId,
        category: resolvedMention.category,
        rawUrl: resolvedMention.rawUrl,
        normalizedUrl: resolvedMention.normalizedUrl,
        domain: resolvedMention.domain,
        baseBucket: resolvedMention.baseBucket,
        autoAssigned: !overridden.overridden,
        reason: overridden.currentReason,
        malformed: resolvedMention.malformed,
        shortener: resolvedMention.shortener,
      });
      if (resolvedMention.domain === 'unknown') return;
      const existing = domainStats.get(resolvedMention.domain) || {
        domain: resolvedMention.domain,
        mentions: 0,
        rows: new Set<string>(),
        autoBaseBucket: baseClassification.bucket || resolvedMention.baseBucket,
        currentBaseBucket: resolvedMention.baseBucket,
        autoReason: overridden.autoReason,
        currentReason: overridden.currentReason,
        overridden: overridden.overridden,
        unmapped: overridden.unmapped,
        classificationSource: overridden.classificationSource,
        overrideNote: overridden.overrideNote,
        updatedAt: overridden.updatedAt,
      };
      existing.mentions += 1;
      existing.rows.add(resolvedMention.rowId);
      existing.autoBaseBucket = baseClassification.bucket || existing.autoBaseBucket;
      existing.currentBaseBucket = resolvedMention.baseBucket;
      existing.autoReason = overridden.autoReason;
      existing.currentReason = overridden.currentReason;
      existing.overridden = overridden.overridden;
      existing.unmapped = overridden.unmapped;
      existing.classificationSource = overridden.classificationSource;
      existing.overrideNote = overridden.overrideNote;
      existing.updatedAt = overridden.updatedAt;
      domainStats.set(resolvedMention.domain, existing);
    });
    if (mentionList.length) {
      linkedRowsById.set(parsedRow.rowId, { ...parsedRow, mentions: mentionList });
    }
    const nextCompleted = index + 1;
    if (onProgress && (nextCompleted === stageA.parsedRows.length || nextCompleted % LINKING_ASYNC_CHUNK_SIZE === 0)) {
      onProgress({
        completed: nextCompleted,
        total: totalRows,
        detail: `Classifying domains for row ${nextCompleted.toLocaleString()} of ${stageA.parsedRows.length.toLocaleString()}`,
      });
      await yieldToBrowser();
    }
  }

  if (onProgress) {
    onProgress({
      completed: totalRows,
      total: totalRows,
      detail: 'Assembling linking dashboard metrics and explorer metadata',
    });
    await yieldToBrowser();
  }

  const linkedRows = linkedRowsById.size;
  const totalUrls = allMentions.length;
  const uniqueDomains = new Set(allMentions.filter((mention) => !mention.malformed).map((mention) => mention.domain)).size;
  const shortenerShare = ratio(allMentions.filter((mention) => mention.shortener).length, totalUrls);
  const malformedShare = ratio(allMentions.filter((mention) => mention.malformed).length, totalUrls);
  const avgUrlsPerRow = ratio(totalUrls, linkedRows);
  const avgDomainsPerRow = linkedRows
    ? [...linkedRowsById.values()].reduce((sum, linkedRow) => sum + new Set(linkedRow.mentions.map((mention) => mention.domain)).size, 0) / linkedRows
    : 0;

  const baseCounts: Record<LinkingBaseBucket, number> = {
    'cross-platform': 0,
    'intra-platform': 0,
    marketplace: 0,
    crowdfunding: 0,
    routing: 0,
    other: 0,
  };

  allMentions.forEach((mention) => {
    baseCounts[mention.baseBucket] += 1;
  });

  const topDomains = [...domainStats.values()]
    .map((stats) => ({
      rank: 0,
      domain: stats.domain,
      mentions: stats.mentions,
      rows: stats.rows.size,
      intensity: ratio(stats.mentions, stats.rows.size),
      ecology: stats.currentBaseBucket,
    }))
    .sort((a, b) => b.mentions - a.mentions || b.rows - a.rows || a.domain.localeCompare(b.domain))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const recipeBuckets = new Map<string, { rows: number; domains: number[]; domainMentions: string[]; structure: string }>();
  const rowAudit: LinkingRowAuditRecord[] = [];

  linkedRowsById.forEach((linkedRow) => {
    const recipe = classifyRecipe({ mentions: linkedRow.mentions, domains: linkedRow.mentions.map((mention) => mention.domain) });
    const entry = recipeBuckets.get(recipe.name) ?? { rows: 0, domains: [], domainMentions: [], structure: recipe.structure };
    entry.rows += 1;
    entry.domains.push(new Set(linkedRow.mentions.map((mention) => mention.domain)).size);
    for (const mention of linkedRow.mentions) {
      entry.domainMentions.push(mention.domain);
    }
    recipeBuckets.set(recipe.name, entry);
    rowAudit.push({
      rowId: linkedRow.rowId,
      recipe: recipe.name,
      baseLabels: unique(linkedRow.mentions.map((mention) => mention.baseBucket)),
      domains: unique(linkedRow.mentions.map((mention) => mention.domain)),
      urlCount: linkedRow.mentions.length,
    });
  });

  const recipes = [...recipeBuckets.entries()]
    .map(([recipe, entry]) => ({
      recipe,
      typicalStructure: entry.structure,
      share: ratio(entry.rows, linkedRows),
      avgDomains: entry.domains.length ? entry.domains.reduce((sum, value) => sum + value, 0) / entry.domains.length : 0,
      signatureDomains: signatureDomains(entry.domainMentions),
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 8);

  const categoryBuckets = new Map<string, LinkingParsedRow[]>();
  linkedRowsById.forEach((linkedRow) => {
    const bucket = categoryBuckets.get(linkedRow.category) ?? [];
    bucket.push(linkedRow);
    categoryBuckets.set(linkedRow.category, bucket);
  });

  const matrixRows = [...categoryBuckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, linkedItems]) => {
      const linkedCount = linkedItems.length;
      const cells: LinkingMatrixCell[] = MATRIX_COLUMNS.map((column) => {
        const count = linkedItems.filter((item) => {
          return item.mentions.some((mention) => mention.baseBucket === column);
        }).length;
        return { column, share: ratio(count, linkedCount) };
      });
      return { label, linkedRows: linkedCount, cells };
    });

  const generatedMetadataByVideoId: Record<string, LinkingGeneratedRowMetadata> = {};
  stageA.parsedRows.forEach((parsedRow) => {
    const mentionList = linkedRowsById.get(parsedRow.rowId)?.mentions ?? [];
    if (!parsedRow.videoId) return;
    const baseLabels = unique(mentionList.map((mention) => mention.baseBucket));
    const domains = unique(mentionList.filter((mention) => mention.domain && mention.domain !== 'unknown').map((mention) => mention.domain));
    const recipe = mentionList.length
      ? classifyRecipe({ mentions: mentionList, domains: mentionList.map((mention) => mention.domain) }).name
      : 'none';
    generatedMetadataByVideoId[parsedRow.videoId] = {
      linking_linked: mentionList.length ? 'yes' : 'no',
      linking_url_count: mentionList.length,
      linking_domain_count: domains.length,
      linking_base_labels: baseLabels,
      linking_recipe: recipe,
      linking_top_domains: domains.slice(0, 5),
      linking_malformed_count: mentionList.filter((mention) => mention.malformed).length,
      linking_shortener_count: mentionList.filter((mention) => mention.shortener).length,
      linking_raw_links: unique(mentionList.map((mention) => mention.normalizedUrl).filter(Boolean)),
      linking_raw_domains: domains,
    };
  });

  const domainAudit = [...domainStats.values()]
    .map((entry) => ({
      domain: entry.domain,
      mentions: entry.mentions,
      rows: entry.rows.size,
      autoBaseBucket: entry.autoBaseBucket,
      currentBaseBucket: entry.currentBaseBucket,
      baseBucket: entry.currentBaseBucket,
      autoReason: entry.autoReason,
      currentReason: entry.currentReason,
      reason: entry.currentReason,
      overridden: entry.overridden,
      unmapped: entry.unmapped,
      classificationSource: entry.classificationSource,
      overrideNote: entry.overrideNote,
      updatedAt: entry.updatedAt,
    }))
    .sort((a, b) => b.mentions - a.mentions || a.domain.localeCompare(b.domain));

  return {
    model: {
      summary: {
        linkedRows,
        totalUrls,
        uniqueDomains,
        avgUrlsPerRow,
        avgDomainsPerRow,
        shortenerShare,
        malformedShare,
      },
      matrixSubtitle: 'Top 5 video categories by linked-row volume',
      matrixColumns: MATRIX_COLUMNS,
      matrixRows,
      baseEcology: [
        { key: 'cross-platform', label: 'cross-platform', share: ratio(baseCounts['cross-platform'], totalUrls) },
        { key: 'intra-platform', label: 'intra-platform', share: ratio(baseCounts['intra-platform'], totalUrls) },
        { key: 'marketplace', label: 'marketplace', share: ratio(baseCounts.marketplace, totalUrls) },
        { key: 'crowdfunding', label: 'crowdfunding', share: ratio(baseCounts.crowdfunding, totalUrls) },
        { key: 'routing', label: 'routing', share: ratio(baseCounts.routing, totalUrls) },
        { key: 'other', label: 'other', share: ratio(baseCounts.other, totalUrls) },
      ],
      recipes,
      topDomains,
      hasLinkedRows: linkedRows > 0,
      sourceColumn: options.sourceColumn,
    },
    mentionAudit,
    domainAudit,
    rowAudit,
    generatedMetadataByVideoId,
  };
}


export function buildLinkingDashboardModel(rows: any[], options: LinkingBuildOptions): LinkingDashboardModel {
  const stageA = buildLinkingStageA(rows, options);
  const stageB = buildLinkingStageB(stageA, { sourceColumn: options.linkColumn });
  return stageB.model;
}

export function aggregateChannelLinkingFromVideoRows(args: {
  videoRows: any[];
  generatedMetadataByVideoId: Record<string, LinkingGeneratedRowMetadata>;
}) {
  const byChannel = new Map<string, {
    channel_name: string;
    channel_id: string | null;
    totalVideos: number;
    linkedVideos: number;
    totalUrls: number;
    domains: Map<string, number>;
    recipeCounts: Map<string, number>;
    baseCounts: Map<string, number>;
  }>();

  args.videoRows.forEach((row) => {
    const videoId = resolveVideoId(row);
    if (!videoId) return;
    const metadata = args.generatedMetadataByVideoId[videoId];
    if (!metadata) return;
    const channelId = resolveChannelId(row);
    const channelName = resolveChannelName(row);
    const channelKey = channelId ? `id:${channelId}` : `name:${channelName.toLowerCase()}`;
    const bucket = byChannel.get(channelKey) || {
      channel_name: channelName,
      channel_id: channelId,
      totalVideos: 0,
      linkedVideos: 0,
      totalUrls: 0,
      domains: new Map<string, number>(),
      recipeCounts: new Map<string, number>(),
      baseCounts: new Map<string, number>(),
    };
    bucket.totalVideos += 1;
    bucket.totalUrls += metadata.linking_url_count;
    if (metadata.linking_linked === 'yes') {
      bucket.linkedVideos += 1;
      bucket.recipeCounts.set(metadata.linking_recipe, (bucket.recipeCounts.get(metadata.linking_recipe) || 0) + 1);
    }
    metadata.linking_raw_domains.forEach((domain) => bucket.domains.set(domain, (bucket.domains.get(domain) || 0) + 1));
    metadata.linking_base_labels.forEach((label) => bucket.baseCounts.set(label, (bucket.baseCounts.get(label) || 0) + 1));
    byChannel.set(channelKey, bucket);
  });

  const toShare = (value: number, total: number) => (total > 0 ? value / total : 0);
  const result: Record<string, Record<string, string | number | null>> = {};
  byChannel.forEach((entry, key) => {
    const topDomains = [...entry.domains.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([domain]) => domain);
    const recipeMix = [...entry.recipeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([recipe, count]) => `${recipe}:${count}`).join(' | ');
    const baseTotal = [...entry.baseCounts.values()].reduce((sum, value) => sum + value, 0);
    result[key] = {
      channel_linked_video_count: entry.linkedVideos,
      channel_total_urls: entry.totalUrls,
      channel_unique_domains: entry.domains.size,
      channel_top_domains: topDomains.join(' | '),
      channel_linking_recipe_mix: recipeMix || null,
      channel_base_share_cross_platform: toShare(entry.baseCounts.get('cross-platform') || 0, baseTotal),
      channel_base_share_intra_platform: toShare(entry.baseCounts.get('intra-platform') || 0, baseTotal),
      channel_base_share_marketplace: toShare(entry.baseCounts.get('marketplace') || 0, baseTotal),
      channel_base_share_crowdfunding: toShare(entry.baseCounts.get('crowdfunding') || 0, baseTotal),
      channel_base_share_routing: toShare(entry.baseCounts.get('routing') || 0, baseTotal),
      channel_base_share_other: toShare(entry.baseCounts.get('other') || 0, baseTotal),
    };
  });

  return result;
}
