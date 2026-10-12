// Builds profile.json for the site from the public GitHub and Steam profiles in profile.config.json.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const config = JSON.parse(await readFile(new URL('../profile.config.json', import.meta.url), 'utf8'));
const output = process.argv[2] ?? 'profile.json';
const token = process.env.GITHUB_TOKEN;
const steamKey = process.env.STEAM_API_KEY;
const STEAM_ID64_BASE = 76561197960265728n;
const EMOTICON = /^https:\/\/(?:community\.[a-z]+\.steamstatic\.com|steamcommunity-a\.akamaihd\.net)\/economy\/emoticon\/[\w-]+$/;

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'user-agent': 'xxseryixx-profile-builder', ...options.headers } });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response;
}

async function github(path) {
  const headers = { accept: 'application/vnd.github+json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return (await request(`https://api.github.com${path}`, { headers })).json();
}

async function pinnedRepos(login) {
  const query = 'query($login: String!) { user(login: $login) { pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { nameWithOwner } } } } }';
  const response = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { login } }),
  });
  const { data, errors } = await response.json();
  if (errors) throw new Error(errors.map((error) => error.message).join('; '));
  return data.user.pinnedItems.nodes.map((node) => node.nameWithOwner);
}

async function loadGitHub(previous) {
  const user = await github(`/user/${config.githubAccountId}`);
  let pinned = [];
  if (!token) {
    console.warn('No GITHUB_TOKEN: pinned repositories skipped.');
  } else {
    try {
      pinned = await pinnedRepos(user.login);
    } catch (error) {
      console.warn(`Pinned repositories unavailable (${error.message}), keeping the previous list.`);
      pinned = previous?.pinned ?? [];
    }
  }

  const owned = await github(`/users/${user.login}/repos?per_page=100`);
  const byName = new Map(owned.map((repo) => [repo.full_name.toLowerCase(), repo]));
  const pinnedNames = new Set(pinned.map((name) => name.toLowerCase()));
  const wanted = [...pinned, ...config.extraProjects.map((name) => (name.includes('/') ? name : `${user.login}/${name}`))];
  const projects = [];
  for (const fullName of new Set(wanted.map((name) => name.toLowerCase()))) {
    const repo = byName.get(fullName) ?? (await github(`/repos/${fullName}`).catch(() => null));
    if (!repo) {
      console.warn(`Project not found: ${fullName}`);
      continue;
    }
    projects.push({
      name: repo.name,
      url: repo.html_url,
      description: repo.description,
      homepage: repo.homepage || null,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      pushedAt: repo.pushed_at,
      pinned: pinnedNames.has(fullName),
    });
  }

  return {
    login: user.login,
    name: user.name,
    bio: user.bio,
    url: user.html_url,
    avatar: user.avatar_url,
    publicRepos: user.public_repos,
    followers: user.followers,
    pinned,
    projects,
  };
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    try {
      return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    } catch {
      return entity;
    }
  });
}

const attr = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return match ? decodeEntities(match[1]) : null;
};

function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function xmlTag(source, name) {
  const match = source.match(new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${name}>`));
  return match ? (match[1] ?? match[2]).replace(/\uFEFF/g, '').trim() : '';
}

// Steam renders the summary as HTML: keep only text, bold, line breaks, emoticons and links.
function parseSummary(html) {
  const lines = [];
  let line = [];
  let linkParts = null;
  let bold = 0;
  for (const [token] of html.matchAll(/<[^>]*>|[^<]+/g)) {
    const target = linkParts ?? line;
    if (token[0] !== '<') {
      // Only ASCII whitespace: the full-width spaces are part of the summary's look.
      const text = decodeEntities(token).replace(/[ \t\r\n]+/g, ' ');
      target.push(bold ? { text, bold: true } : { text });
    } else if (/^<br\b|^<\/?(?:div|p)\b/i.test(token)) {
      if (!linkParts) {
        lines.push(line);
        line = [];
      }
    } else if (/^<(?:b|strong)\b/i.test(token)) {
      bold++;
    } else if (/^<\/(?:b|strong)\b/i.test(token)) {
      bold = Math.max(0, bold - 1);
    } else if (/^<img\b/i.test(token)) {
      const src = attr(token, 'src') ?? '';
      if (EMOTICON.test(src)) target.push({ emoticon: src });
    } else if (/^<a\b/i.test(token)) {
      const href = httpUrl(attr(token, 'href') ?? '');
      if (href && !linkParts) {
        linkParts = [];
        line.push({ link: href, parts: linkParts });
      }
    } else if (/^<\/a\b/i.test(token)) {
      linkParts = null;
    }
  }
  lines.push(line);

  const space = (part) => part.text !== undefined && part.text.trim() === '';
  const blank = (parts) => parts.every((part) => (part.link ? blank(part.parts) : space(part)));
  for (const parts of lines) {
    while (parts.length && space(parts[0])) parts.shift();
    while (parts.length && space(parts.at(-1))) parts.pop();
  }
  while (lines.length && blank(lines[0])) lines.shift();
  while (lines.length && blank(lines.at(-1))) lines.pop();
  return lines;
}

async function steamApi(method, params) {
  const query = new URLSearchParams({ key: steamKey, steamid: config.steamId64, ...params });
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://api.steampowered.com/${method}/v1/?${query}`, { signal: AbortSignal.timeout(60_000) });
    if (response.ok) return (await response.json()).response ?? {};
    // Name the method only: the URL contains the key.
    if (attempt === 3 || (response.status !== 429 && response.status < 500)) throw new Error(`${method} answered HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

// Owned games plus every app ever played, so games completed without owning them count too.
async function achievementTotals() {
  const [owned, played] = await Promise.all([
    steamApi('IPlayerService/GetOwnedGames', { include_played_free_games: 1, skip_unvetted_apps: 0 }),
    steamApi('IPlayerService/ClientGetLastPlayedTimes', { min_last_played: 0 }),
  ]);
  const appIds = [...new Set([...(owned.games ?? []), ...(played.games ?? [])].map((game) => game.appid))];
  const games = [];
  let next = 0;
  const worker = async () => {
    while (next < appIds.length) {
      const params = { language: 'english', max_achievements: 10000 };
      appIds.slice(next, next + 100).forEach((appId, index) => { params[`appids[${index}]`] = appId; });
      next += 100;
      games.push(...((await steamApi('IPlayerService/GetTopAchievementsForGames', params)).games ?? []));
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const started = games.filter((game) => game.total_achievements > 0 && game.achievements?.length);
  return {
    unlocked: started.reduce((sum, game) => sum + game.achievements.length, 0),
    started: started.length,
    perfect: started.filter((game) => game.achievements.length === game.total_achievements).length,
  };
}

async function loadSteam() {
  const base = `https://steamcommunity.com/profiles/${config.steamId64}`;
  const accountId = String(BigInt(config.steamId64) - STEAM_ID64_BASE);
  const [xml, mini, html] = await Promise.all([
    request(`${base}/?xml=1`).then((response) => response.text()),
    request(`https://steamcommunity.com/miniprofile/${accountId}/json`).then((response) => response.json()),
    request(`${base}/?l=english`).then((response) => response.text()),
  ]);

  const head = xml.split('<mostPlayedGames>')[0];
  if (!xmlTag(head, 'steamID')) throw new Error('the profile XML has no steamID');
  const customUrl = xmlTag(head, 'customURL');
  const profileUrl = customUrl ? `https://steamcommunity.com/id/${customUrl}/` : `${base}/`;
  const video = html.match(/class="profile_animated_background"[\s\S]*?<\/video>/)?.[0];
  const badge = mini.favorite_badge;

  // Sidebar counts first, then the profile showcases (achievements and perfect games only appear there).
  const stats = new Map();
  for (const [, url, label, value] of html.matchAll(/<a href="([^"]+)">\s*<span class="count_link_label">([^<]+)<\/span>(?:&nbsp;|\s)*<span class="profile_count_link_total">\s*([\d,]+)/g)) {
    stats.set(decodeEntities(label.trim()), { value, url: decodeEntities(url), tooltip: null });
  }
  for (const [, outer, inner = '', value, label] of html.matchAll(/<(?:a|div) class="showcase_stat"([^>]*)>\s*(?:<a class="showcase_stat"([^>]*)>\s*)?<div class="value">\s*([^<]+?)\s*<\/div>\s*<div class="label">\s*([^<]+?)\s*<\/div>/g)) {
    const name = decodeEntities(label);
    if (stats.has(name)) continue;
    const tooltip = attr(outer, 'data-tooltip-text') ?? attr(inner, 'data-tooltip-text');
    stats.set(name, { value: decodeEntities(value), url: attr(outer, 'href') ?? attr(inner, 'href'), tooltip });
  }
  const achievements = stats.get('Achievements');
  if (achievements) achievements.url ??= `${profileUrl}games/?tab=all&sort=achievements`;

  if (steamKey) {
    try {
      const totals = await achievementTotals();
      const shown = (name) => Number(stats.get(name)?.value.replace(/\D/g, '') ?? 0);
      if (totals.perfect < shown('Perfect Games') || totals.unlocked < shown('Achievements')) {
        throw new Error(`found fewer than the profile: ${totals.perfect} perfect games, ${totals.unlocked} achievements`);
      }
      const format = (count) => count.toLocaleString('en');
      stats.set('Achievements', {
        value: format(totals.unlocked),
        url: `${profileUrl}games/?tab=all&sort=achievements`,
        tooltip: `${format(totals.unlocked)} achievements in ${format(totals.started)} different games.`,
      });
      stats.set('Perfect Games', {
        value: format(totals.perfect),
        url: `${profileUrl}games/?tab=perfect`,
        tooltip: 'Games with every achievement unlocked, including games outside the library.',
      });
    } catch (error) {
      console.warn(`Steam Web API counts skipped (${error.message}): showing the profile's.`);
    }
  }

  return {
    url: profileUrl,
    persona: xmlTag(head, 'steamID'),
    realName: xmlTag(head, 'realname'),
    location: xmlTag(head, 'location'),
    flag: html.match(/class="profile_flag" src="([^"]+)"/)?.[1] ?? null,
    memberSince: xmlTag(head, 'memberSince'),
    summary: parseSummary(xmlTag(head, 'summary')),
    avatar: xmlTag(head, 'avatarFull'),
    avatarFrame: mini.avatar_frame ?? null,
    background: html.match(/full_width_background"\s+style="background-image: url\(\s*'([^']+)'/)?.[1] ?? null,
    backgroundVideo: video && {
      poster: attr(video, 'poster'),
      webm: video.match(/<source src="([^"]+)" type="video\/webm"/)?.[1] ?? null,
      mp4: video.match(/<source src="([^"]+)" type="video\/mp4"/)?.[1] ?? null,
    },
    level: mini.level ?? null,
    favoriteBadge: badge ? { name: badge.name, xp: badge.xp, description: badge.description, icon: badge.icon } : null,
    stats: Object.entries(config.steamStats).flatMap(([steamLabel, label]) => {
      const stat = stats.get(steamLabel);
      if (!stat) console.warn(`Steam stat not on the profile: ${steamLabel}`);
      return stat ? [{ label, ...stat }] : [];
    }),
  };
}

const escapeXml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// The GitHub profile README can show images but can't run code, so the stats go there as an SVG.
function statsCard(steam, date) {
  const tiles = [...(Number.isFinite(steam.level) ? [{ label: 'Level', value: String(steam.level) }] : []), ...steam.stats];
  const [width, height, gap] = [840, 152, 12];
  const tileWidth = (width - 48 - gap * (tiles.length - 1)) / tiles.length;
  const updated = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' }).format(date);
  const title = `${steam.persona} on Steam: ${tiles.map((tile) => `${tile.value} ${tile.label}`).join(', ')}`;
  const cells = tiles.map((tile, index) => `
  <g transform="translate(${(24 + index * (tileWidth + gap)).toFixed(1)} 56)">
    <rect width="${tileWidth.toFixed(1)}" height="72" rx="3" fill="#000" fill-opacity=".45" stroke="#f13292" stroke-opacity=".35"/>
    <text x="14" y="38" class="value">${escapeXml(tile.value)}</text>
    <text x="14" y="59" class="label">${escapeXml(tile.label)}</text>
  </g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(title)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a0f3a"/><stop offset=".6" stop-color="#0b0816"/><stop offset="1" stop-color="#07070c"/>
    </linearGradient>
    <filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <style>
    text { font-family: 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .name { fill: #fff; font-size: 22px; font-weight: 300; }
    .name-glow { fill: #f13292; font-size: 22px; font-weight: 300; }
    .on { fill: #ddbed2; font-size: 15px; }
    .date { fill: #969696; font-size: 12px; }
    .value { fill: #fff; font-size: 28px; font-weight: 300; }
    .label { fill: #ebebeb; font-size: 13px; }
  </style>
  <rect x="5" y="5" width="${width - 10}" height="${height - 10}" rx="4" fill="url(#bg)"/>
  <rect x="5" y="5" width="${width - 10}" height="${height - 10}" rx="4" fill="none" stroke="#f13292" stroke-width="3" filter="url(#glow)"/>
  <rect x="5.5" y="5.5" width="${width - 11}" height="${height - 11}" rx="4" fill="none" stroke="#fff" stroke-opacity=".55"/>
  <text x="24" y="40" class="name-glow" filter="url(#glow)">${escapeXml(steam.persona)}</text>
  <text x="24" y="40"><tspan class="name">${escapeXml(steam.persona)}</tspan><tspan class="on" dx="10">on Steam</tspan></text>
  <text x="${width - 24}" y="40" class="date" text-anchor="end">Updated ${updated}</text>${cells}
</svg>
`;
}

async function loadPrevious() {
  const url = process.env.PREVIOUS_PROFILE_URL;
  if (!url) return null;
  try {
    return await (await request(url)).json();
  } catch (error) {
    console.warn(`No previous profile data (${error.message}).`);
    return null;
  }
}

const previous = await loadPrevious();
const githubData = await loadGitHub(previous?.github);
const steam = await loadSteam().catch((error) => {
  console.warn(`Steam unavailable (${error.message}), keeping the previous data.`);
  return previous?.steam ?? null;
});
const source = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : null;
const generatedAt = new Date();
await writeFile(output, `${JSON.stringify({ generatedAt: generatedAt.toISOString(), source, github: githubData, steam }, null, 2)}\n`);
if (steam) await writeFile(join(dirname(output), 'card.svg'), statsCard(steam, generatedAt));
console.log(`Wrote ${output}: ${githubData.projects.length} projects, Steam ${steam ? 'included, with card.svg' : 'missing'}.`);
