export function sanitizeOwnerTag(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  if (!slug) throw new Error("INVALID_OWNER_TAG");
  return slug;
}

export function buildComposeProject(ownerTag: string, licenseId: number): string {
  return `openclaw-${ownerTag}-${licenseId}`;
}

export function buildConfigDir(dataDir: string, composeProject: string): string {
  return `${dataDir}/${composeProject}/.openclaw`;
}

export function buildWorkspaceDir(dataDir: string, composeProject: string): string {
  return `${dataDir}/${composeProject}/.openclaw/workspace`;
}

export function buildNginxHost(ownerTag: string, licenseId: number, baseDomain: string): string {
  return `${ownerTag}-${licenseId}.${baseDomain}`;
}
