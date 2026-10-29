# Deploy preflight - the traps in docs/DEV_MAP.md §7, checked instead of remembered.
#
# WHY THIS EXISTS: three consecutive deploys began with Docker Desktop down, and each one was
# diagnosed by hand from a confusing error further along. Every check below has already cost a
# deploy at least once, and each one is a question with a definite answer - so it should be asked
# by a script, not by whoever happens to be shipping.
#
# Docker Desktop's own "start when you sign in" is DELIBERATELY left off: nearly every startup
# item on this machine is disabled, which is a considered choice about boot time, and a deploy
# that happens weekly is a poor reason to overturn it. The daemon is needed at DEPLOY time, so
# that is where it gets started.
#
# Read-only except for starting Docker Desktop. Nothing here builds, pushes or migrates.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-preflight.ps1
#   npm run deploy:preflight
#
# Exits non-zero if anything is wrong, so it can gate a deploy chain.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$problems = New-Object System.Collections.Generic.List[string]
$notes    = New-Object System.Collections.Generic.List[string]

function Ok   ($m) { Write-Host "  OK    $m" }
function Warn ($m) { Write-Host "  WARN  $m"; $notes.Add($m) }
function Bad  ($m) { Write-Host "  FAIL  $m"; $problems.Add($m) }

Write-Host ""
Write-Host "B2 deploy preflight"
Write-Host "==================="

# ── 1 · Docker daemon ───────────────────────────────────────────────────────────────────────
# `docker info` is the only honest test: the Desktop process can be up while the engine is still
# booting, and a build started in that window fails with an error about the socket.
Write-Host ""
Write-Host "Docker"
docker info *> $null
if ($?) {
  Ok "daemon is answering"
} else {
  $exe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $exe)) {
    Bad "the Docker daemon is not answering and Docker Desktop is not at the expected path"
  } else {
    Write-Host "  ...    daemon is not answering - starting Docker Desktop"
    if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
      Start-Process $exe | Out-Null
    }
    # Up to 3 minutes. A cold WSL VM start on this box is routinely over a minute, and a preflight
    # that gives up before the thing it started is ready would be worse than no preflight.
    $deadline = (Get-Date).AddMinutes(3)
    $up = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 5
      docker info *> $null
      if ($?) { $up = $true; break }
    }
    if ($up) { Ok "daemon came up" } else { Bad "Docker Desktop did not become ready within 3 minutes" }
  }
}

# ── 2 · What would actually be shipped ──────────────────────────────────────────────────────
# `docker build` sends the WORKING TREE as its context, not the commit. A dirty tree therefore
# ships uncommitted edits under a commit's name, which is unreproducible and unrollbackable.
Write-Host ""
Write-Host "Git"
Push-Location $root
try {
  $branch = (git symbolic-ref --short HEAD 2>$null)
  if ($LASTEXITCODE -ne 0) {
    Bad "detached HEAD - `git push` would push nothing and say nothing"
  } elseif ($branch -ne "master") {
    # The 24 Oct deploy: work sat on a branch, `git push origin master` reported "up-to-date",
    # and nothing shipped.
    Bad "on branch '$branch', not 'master' - a push to master would report up-to-date and ship nothing"
  } else {
    Ok "on master"
  }

  $dirty = git status --porcelain
  if ($dirty) {
    $n = ($dirty | Measure-Object -Line).Lines
    Warn "$n uncommitted file(s) - build from ``git archive HEAD``, or the image carries them"
  } else {
    Ok "working tree is clean"
  }

  git fetch --quiet origin 2>$null
  $ahead = (git rev-list --count "origin/master..HEAD" 2>$null)
  if ($LASTEXITCODE -eq 0 -and $ahead -and [int]$ahead -gt 0) {
    Warn "$ahead commit(s) not pushed to origin/master yet"
  }
} finally { Pop-Location }

# ── 3 · Migrations ──────────────────────────────────────────────────────────────────────────
# The compose `migrate` service is a SEPARATE build, so it silently does not run on a plain image
# swap. Migrations must be applied against live BEFORE the new image starts serving.
Write-Host ""
Write-Host "Migrations"
$applied = Join-Path $root "prisma\migrations"
if (Test-Path $applied) {
  $latest = Get-ChildItem $applied -Directory | Sort-Object Name | Select-Object -Last 1
  Warn "latest migration is '$($latest.Name)' - run ``npm run db:deploy`` BEFORE shipping the image (compose's migrate service does not run on an image swap)"
} else {
  Bad "prisma\migrations is missing"
}

# ── 4 · tsconfig ────────────────────────────────────────────────────────────────────────────
# `next lint` and `next build` re-append dead paths to `include`, which then fail typecheck with
# TS6053 noise that looks like a real error.
Write-Host ""
Write-Host "tsconfig"
# The `include` block carries a long explanatory comment that NAMES the dead paths it exists to
# keep out, in quotes. Strip `//` lines first or the check reads its own documentation as config -
# which is exactly what the first version of this script did.
$ts = (Get-Content (Join-Path $root "tsconfig.json")) |
  Where-Object { $_.Trim() -notlike "//*" } |
  Out-String
$includes = [regex]::Matches($ts, '"include"\s*:\s*\[(.*?)\]', "Singleline")
if ($includes.Count -eq 1) {
  $entries = [regex]::Matches($includes[0].Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
  $missing = $entries | Where-Object { $_ -notmatch '[\*\?]' -and -not (Test-Path (Join-Path $root $_)) }
  if ($missing) { Bad "tsconfig include names path(s) that do not exist: $($missing -join ', ')" }
  else { Ok "include has $($entries.Count) entr(ies), all present" }
}

# ── 5 · Image housekeeping ──────────────────────────────────────────────────────────────────
# Not a blocker, but a rollback tag is only useful if it can be found. This counts LOCAL tags;
# the same check on the box is `docker images b2-app --format '{{.Tag}}' | wc -l`.
Write-Host ""
Write-Host "Local images"
$tags = docker images "b2-app" --format "{{.Tag}}" 2>$null
if ($?) {
  $count = ($tags | Measure-Object).Count
  $rollbacks = @($tags | Where-Object { $_ -like "rollback-*" })
  if ($count -gt 8) {
    Warn "$count b2-app tags locally ($($rollbacks.Count) rollback-*). Prune all but the rollback tags and the current one: docker image prune -a --filter 'until=336h'"
  } else {
    Ok "$count b2-app tag(s), $($rollbacks.Count) of them rollback-*"
  }
}

# ── Verdict ─────────────────────────────────────────────────────────────────────────────────
Write-Host ""
if ($problems.Count -gt 0) {
  Write-Host "BLOCKED - $($problems.Count) problem(s):"
  foreach ($p in $problems) { Write-Host "  - $p" }
  exit 1
}
Write-Host "Preflight passed$(if ($notes.Count) { " with $($notes.Count) note(s) to read above" })."
exit 0
