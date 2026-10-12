# xxseryixx.github.io

[![deploy](https://github.com/XxSeRyIxX/xxseryixx.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/XxSeRyIxX/xxseryixx.github.io/actions/workflows/deploy.yml)

My profile page, styled after my Steam profile: Steam level, badges, games,
achievements and completed games, plus the GitHub projects I want to show.

**[Open it](https://xxseryixx.github.io/)**

## How it works

- [index.html](index.html) is the whole site: one static page, with no framework
  or dependencies, that draws itself from `profile.json`.
- [scripts/build-profile.mjs](scripts/build-profile.mjs) writes `profile.json`
  from the GitHub API, the public Steam profile and, with a key, the Steam Web
  API. If Steam can't be reached, it keeps the previous Steam data. If GitHub
  can't, the run fails and the last published page stays up. It also writes
  `card.svg`, the Steam stats card on my GitHub profile.
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs the script
  and publishes the page to GitHub Pages on every push, every Monday at 00:00
  Madrid time, and from **Run workflow** in the Actions tab.

GitHub pauses scheduled workflows in public repositories after 60 days without
activity. If the weekly update stops, enable the workflow again in the Actions
tab.

## Setup

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Optional: create a Steam Web API key at <https://steamcommunity.com/dev/apikey>
   and add it in **Settings → Secrets and variables → Actions** as
   `STEAM_API_KEY`. With it, Achievements and Games Completed also count games
   played outside the library, such as removed licenses. Without it, the page
   shows the numbers from the public Steam profile. Keep the key secret: anyone
   who has it can interfere with the account's trade offers.

Pinned repositories are read with the workflow's own token, so nothing else is
needed.

## Configuration

[profile.config.json](profile.config.json):

| Key | What it does |
| --- | --- |
| `githubAccountId` | The numeric GitHub account id, which survives username changes. |
| `steamId64` | The 64-bit Steam id. |
| `extraProjects` | Repositories shown after the pinned ones: `name` for your own, `owner/name` for anyone else's. |
| `steamStats` | The Steam profile stats to show, as `"label on Steam": "label on the page"`. |

## Build locally

Needs Node.js 18 or later.

```sh
node scripts/build-profile.mjs profile.json
python -m http.server 8000
```

Then open <http://localhost:8000/>. Opening `index.html` straight from disk
doesn't work, because browsers block it from reading `profile.json`. Set
`GITHUB_TOKEN` to include the pinned repositories, and `STEAM_API_KEY` for the
full Steam counts.

## Privacy

The page sets no cookies and has no analytics. Visitors' browsers load the
pictures straight from GitHub's and Steam's servers, and GitHub Pages logs
visitors' IP addresses for security, as GitHub's privacy statement describes.

The build reads only my own GitHub and Steam accounts. It publishes only what
the page shows, in `profile.json` on GitHub Pages, run by GitHub, Inc. in the
United States. The list of games it reads to count achievements is not stored.

## Licence

[GNU AGPL v3](LICENSE) or later. You are free to use, study, modify and share
it. If you distribute a modified version, or run one as a network service, you
have to publish your source under the same licence.

The Steam and GitHub content the page shows, such as avatars, backgrounds,
badges and profile text, belongs to its owners and is **not** covered by that
licence. See [NOTICE](NOTICE).

Not affiliated with, endorsed by, or connected to Valve or GitHub. Steam is a
trademark of Valve Corporation.