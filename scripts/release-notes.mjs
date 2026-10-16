/** Extract one version's Markdown body; never include Unreleased or other versions. */
export function extractReleaseNotes(changelog, tagName) {
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tagName)) {
    throw new Error(`Invalid release tag: ${tagName}`);
  }
  const version = tagName.replace(/^v/, '');
  const lines = changelog.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let fence = null;
  let collecting = false;
  let found = false;
  const body = [];

  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) {
        fence = marker[1];
      } else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      if (collecting) body.push(line);
      continue;
    }
    if (!fence && /^##\s+/.test(line)) {
      const heading = line.match(/^##\s+\[([^\]]+)\](?:\s.*)?$/);
      collecting = heading?.[1] === version;
      if (collecting) {
        if (found) throw new Error(`Duplicate changelog section: ${version}`);
        found = true;
      }
      continue;
    }
    if (collecting) body.push(line);
  }

  const notes = body.join('\n').trim();
  const content = notes.replace(/<!--[\s\S]*?-->/g, '').replace(/^#{1,6}\s+.*$/gm, '').trim();
  return content ? notes : null;
}

/** Network access is supplied by the workflow, keeping extraction offline/testable. */
export async function buildReleaseNotes({ changelog, tagName, generateNotes }) {
  const curated = extractReleaseNotes(changelog, tagName);
  if (curated) return curated;
  const generated = await generateNotes(tagName);
  if (typeof generated !== 'string' || !generated.trim()) {
    throw new Error('GitHub generated empty release notes');
  }
  return generated.trim();
}
