import React, { useEffect, useState } from 'react';
import { Github, ImageOff } from 'lucide-react';
import type { Resource } from './Importer';

/**
 * Public GitHub imagery, no API token or additional rate-limited API calls.
 * A custom imageUrl takes priority. Otherwise use GitHub's social card,
 * then the repository owner's avatar. If either fails, show an icon.
 * Images are only requested for the currently rendered (paginated) cards.
 */
function repoLocation(url: string): { owner: string; repo?: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'github.com' && parsed.hostname.toLowerCase() !== 'www.github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts[0] || !/^[a-z0-9-]+$/i.test(parts[0])) return null;
    if (parts[1] && !/^[a-z0-9_.-]+$/i.test(parts[1])) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch { return null; }
}
function safeCustomImage(raw?: string): string | undefined {
  if (!raw) return undefined;
  try { const u = new URL(raw); return u.protocol === 'https:' ? u.toString() : undefined; } catch { return undefined; }
}
function colorForCategory(category: string): number {
  let h = 0;
  for (const char of category) h = (h * 31 + char.charCodeAt(0)) % 997;
  return h % 6;
}

export default function RepoVisual({ resource }: { resource: Resource }) {
  const { url, name, category, type, imageUrl } = resource;
  const location = repoLocation(url);
  const avatar = location ? `https://github.com/${encodeURIComponent(location.owner)}.png?size=96` : undefined;
  const ogImage = location?.repo && type !== 'profile' ? `https://opengraph.githubassets.com/1/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}` : undefined;
  const custom = safeCustomImage(imageUrl);
  const primary = custom || ogImage || avatar;
  const [source, setSource] = useState(primary);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => { setSource(primary); setLogoFailed(false); }, [primary]);
  const tone = colorForCategory(category || 'Uncategorized');
  return <div className={`repo-visual repo-tone-${tone}`}>
    <div className="repo-visual-orb" aria-hidden="true"/>
    {source ? <img className={`repo-preview-image ${source === avatar ? 'is-avatar-preview' : ''}`} src={source} alt={`${name} repository preview`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setSource(old => {
        if (custom && old === custom && ogImage && ogImage !== custom) return ogImage;
        if (avatar && old !== avatar) return avatar;
        return undefined;
      })} />
      : <div className="repo-preview-placeholder" aria-label="No project preview available"><ImageOff size={22}/><span>{(name || 'Repository').slice(0, 26)}</span></div>}
    {avatar && location?.repo && <span className="repo-owner-avatar">
      {!logoFailed ? <img src={avatar} loading="lazy" decoding="async" alt={`${location.owner} avatar`} onError={() => setLogoFailed(true)}/> : <Github size={17}/>}
    </span>}
  </div>;
}
