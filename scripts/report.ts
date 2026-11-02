// The report of a run: counts, a JSON form and a plain-text form.
import type { Limits } from "./config.ts";
import { Level, type Finding } from "./checks.ts";

export interface Report {
  readonly findings: readonly (Finding & { readonly file: string })[];
  readonly count: number;
  readonly hard_count: number;
  readonly warn_count: number;
  readonly profile: string;
  readonly limits: Limits;
}

const JSON_INDENT = 2;

export function summarize(findings: Report["findings"], profile: string, limits: Limits): Report {
  const hard = findings.filter((finding) => finding.level === Level.Hard).length;
  return { findings, count: findings.length, hard_count: hard, warn_count: findings.length - hard, profile, limits };
}

export const failed = (report: Report): boolean => report.hard_count > 0;

export const toJSON = (report: Report): string => JSON.stringify(report, null, JSON_INDENT);

const lineOf = (finding: Report["findings"][number]): string => `${finding.file}:${finding.line}:${finding.col}: ${finding.level} ${finding.check}: ${finding.message}`;

export const toText = (report: Report): string =>
  [...report.findings.map(lineOf), `${report.count} findings (${report.hard_count} hard, ${report.warn_count} warn) for profile ${report.profile}`].join("\n");
